import { describe, expect, mock, test } from "bun:test";

import type { ObjectReader } from "../clients.js";
import { toPackageId, toPublicationId, toSuiAddress } from "../codecs.js";
import { NotFoundError, TransportError, ValidationError } from "../errors.js";
import { StorageMode } from "../types.js";
import { RpcPublicationReader } from "./reader.js";

const PACKAGE_ID = toPackageId(
	"0x35b5e28d27f5acf23fe6181815b4603ec9b560d52c4edab8fdf0e331efc42c31",
);
const PUBLICATION_ID = toPublicationId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const ADDRESS = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000cccc",
);

interface MockReaderOverrides {
	getObject?: (...args: unknown[]) => Promise<unknown>;
	listOwnedObjects?: (...args: unknown[]) => Promise<unknown>;
	listDynamicFields?: (...args: unknown[]) => Promise<unknown>;
}

function makeReader(overrides: MockReaderOverrides = {}): ObjectReader {
	return {
		getObject: overrides.getObject ?? mock(async () => ({ object: null })),
		listOwnedObjects:
			overrides.listOwnedObjects ??
			mock(async () => ({ objects: [], hasNextPage: false, cursor: null })),
		listDynamicFields:
			overrides.listDynamicFields ??
			mock(async () => ({
				dynamicFields: [],
				hasNextPage: false,
				cursor: null,
			})),
	} as unknown as ObjectReader;
}

function publicationObject(json: Record<string, unknown>) {
	return {
		object: {
			objectId: PUBLICATION_ID,
			version: "1",
			digest: "abc",
			owner: { $kind: "Shared", Shared: { initialSharedVersion: "1" } },
			type: `${PACKAGE_ID}::publication::Publication`,
			json,
		},
	};
}

function happyPathPublicationJson(): Record<string, unknown> {
	return {
		id: { id: PUBLICATION_ID },
		name: "My Publication",
		slug: "my-publication",
		collections: {
			contents: [
				{
					key: "blog",
					value: {
						name: "blog",
						storage_mode: 0,
						next_entry_id: "5",
						entries: {
							id: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
						},
					},
				},
				{
					key: "files",
					value: {
						name: "files",
						storage_mode: 1,
						next_entry_id: 0,
						entries: {
							id: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
						},
					},
				},
			],
		},
		revoked_publisher_caps: {
			id: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		},
	};
}

describe("RpcPublicationReader.getPublication", () => {
	test("parses a publication with two collections", async () => {
		const client = makeReader({
			getObject: mock(async () =>
				publicationObject(happyPathPublicationJson()),
			),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		const publication = await reader.getPublication(PUBLICATION_ID);
		expect(publication.id as string).toBe(PUBLICATION_ID as string);
		expect(publication.name).toBe("My Publication");
		expect(publication.slug).toBe("my-publication");
		expect(publication.collections).toHaveLength(2);

		const blog = publication.collections[0];
		expect(blog?.name).toBe("blog");
		expect(blog?.storageMode).toBe(StorageMode.Blob);
		expect(blog?.nextEntryId).toBe(5);

		const files = publication.collections[1];
		expect(files?.name).toBe("files");
		expect(files?.storageMode).toBe(StorageMode.Quilt);
		expect(files?.nextEntryId).toBe(0);
	});

	test("throws NotFoundError when the response object is null", async () => {
		const client = makeReader({
			getObject: mock(async () => ({ object: null })),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		await expect(reader.getPublication(PUBLICATION_ID)).rejects.toThrow(
			NotFoundError,
		);
	});

	test("throws NotFoundError when the RPC throws an object-not-found error", async () => {
		const client = makeReader({
			getObject: mock(async () => {
				throw new Error(`Object ${PUBLICATION_ID} not found`);
			}),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		await expect(reader.getPublication(PUBLICATION_ID)).rejects.toThrow(
			NotFoundError,
		);
	});

	test("does not misclassify a generic transport failure as NotFoundError", async () => {
		const client = makeReader({
			getObject: mock(async () => {
				throw new Error("service unavailable: connection not found");
			}),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		await expect(reader.getPublication(PUBLICATION_ID)).rejects.toThrow(
			TransportError,
		);
	});

	test("throws ValidationError when JSON is missing", async () => {
		const client = makeReader({
			getObject: mock(async () => ({
				object: { objectId: PUBLICATION_ID, json: null },
			})),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		await expect(reader.getPublication(PUBLICATION_ID)).rejects.toThrow(
			ValidationError,
		);
	});

	test("throws ValidationError when name field is wrong type", async () => {
		const json = happyPathPublicationJson();
		json.name = 42;
		const client = makeReader({
			getObject: mock(async () => publicationObject(json)),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		await expect(reader.getPublication(PUBLICATION_ID)).rejects.toThrow(
			ValidationError,
		);
	});

	test("throws ValidationError when storage_mode is not 0 or 1", async () => {
		const json = happyPathPublicationJson();
		const collections = json["collections"] as { contents: unknown[] };
		const first = collections.contents[0] as {
			value: { storage_mode: number };
		};
		first.value.storage_mode = 7;
		const client = makeReader({
			getObject: mock(async () => publicationObject(json)),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		await expect(reader.getPublication(PUBLICATION_ID)).rejects.toThrow(
			ValidationError,
		);
	});

	test("wraps RPC failure in TransportError preserving cause", async () => {
		const cause = new Error("rpc down");
		const client = makeReader({
			getObject: mock(async () => {
				throw cause;
			}),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		try {
			await reader.getPublication(PUBLICATION_ID);
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(TransportError);
			expect((error as TransportError).cause).toBe(cause);
		}
	});
});

describe("RpcPublicationReader.listPublicationsOwnedBy", () => {
	test("returns parsed handles plus a next cursor", async () => {
		const client = makeReader({
			listOwnedObjects: mock(async () => ({
				objects: [
					{
						objectId:
							"0x0000000000000000000000000000000000000000000000000000000000000111",
						type: `${PACKAGE_ID}::publication::OwnerCap`,
						json: {
							publication_id:
								"0x0000000000000000000000000000000000000000000000000000000000000aaa",
						},
					},
					{
						objectId:
							"0x0000000000000000000000000000000000000000000000000000000000000222",
						type: `${PACKAGE_ID}::publication::OwnerCap`,
						json: {
							publication_id:
								"0x0000000000000000000000000000000000000000000000000000000000000bbb",
						},
					},
				],
				hasNextPage: true,
				cursor: "page-2",
			})),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		const page = await reader.listPublicationsOwnedBy(ADDRESS);
		expect(page.results).toHaveLength(2);
		expect(page.results[0]?.ownerCapId as string).toBe(
			"0x0000000000000000000000000000000000000000000000000000000000000111",
		);
		expect(page.results[0]?.publicationId as string).toBe(
			"0x0000000000000000000000000000000000000000000000000000000000000aaa",
		);
		expect(page.nextCursor).toBe("page-2");
	});

	test("forwards limit, cursor, and signal options to the RPC", async () => {
		const spy = mock(async () => ({
			objects: [],
			hasNextPage: false,
			cursor: null,
		}));
		const reader = new RpcPublicationReader(
			makeReader({ listOwnedObjects: spy }),
			PACKAGE_ID,
		);
		const controller = new AbortController();
		await reader.listPublicationsOwnedBy(ADDRESS, {
			limit: 5,
			cursor: "page-x",
			signal: controller.signal,
		});
		const calls = spy.mock.calls as unknown as Array<
			Array<Record<string, unknown>>
		>;
		const args = calls[0]?.[0] ?? {};
		expect(args["limit"]).toBe(5);
		expect(args["cursor"]).toBe("page-x");
		expect(args["signal"]).toBe(controller.signal);
		expect(args["type"]).toBe(`${PACKAGE_ID}::publication::OwnerCap`);
	});

	test("throws ValidationError when an OwnerCap is missing publication_id", async () => {
		const client = makeReader({
			listOwnedObjects: mock(async () => ({
				objects: [
					{
						objectId:
							"0x0000000000000000000000000000000000000000000000000000000000000111",
						type: `${PACKAGE_ID}::publication::OwnerCap`,
						json: {},
					},
				],
				hasNextPage: false,
				cursor: null,
			})),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		await expect(reader.listPublicationsOwnedBy(ADDRESS)).rejects.toThrow(
			ValidationError,
		);
	});
});
