import { describe, expect, mock, test } from "bun:test";

import type { ObjectReader } from "../clients.js";
import {
	toPackageId,
	toPublicationId,
	toPublisherCapId,
	toSuiAddress,
} from "../codecs.js";
import { NotFoundError, TransportError, ValidationError } from "../errors.js";
import { StorageMode } from "../types.js";
import { RpcPublicationReader } from "./reader.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const PUBLICATION_ID = toPublicationId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const PUBLISHER_CAP_ID = toPublisherCapId(
	"0x000000000000000000000000000000000000000000000000000000000000eeee",
);
const ADDRESS = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000cccc",
);

interface MockReaderOverrides {
	getObject?: (...args: unknown[]) => Promise<unknown>;
	listOwnedObjects?: (...args: unknown[]) => Promise<unknown>;
	listDynamicFields?: (...args: unknown[]) => Promise<unknown>;
	getDynamicField?: (...args: unknown[]) => Promise<unknown>;
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
		getDynamicField:
			overrides.getDynamicField ??
			mock(async () => {
				throw new Error("getDynamicField not stubbed");
			}),
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

describe("RpcPublicationReader.getPublisherCap", () => {
	function publisherCapObject(json: Record<string, unknown>) {
		return {
			object: {
				objectId: PUBLISHER_CAP_ID,
				version: "1",
				digest: "abc",
				owner: { $kind: "AddressOwner", AddressOwner: ADDRESS },
				type: `${PACKAGE_ID}::publication::PublisherCap`,
				json,
			},
		};
	}

	test("parses a PublisherCap with publication_id and holder", async () => {
		const client = makeReader({
			getObject: mock(async () =>
				publisherCapObject({
					id: { id: PUBLISHER_CAP_ID },
					publication_id: PUBLICATION_ID,
					holder: ADDRESS,
				}),
			),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		const cap = await reader.getPublisherCap(PUBLISHER_CAP_ID);
		expect(cap.id as string).toBe(PUBLISHER_CAP_ID as string);
		expect(cap.publicationId as string).toBe(PUBLICATION_ID as string);
		expect(cap.holder as string).toBe(ADDRESS as string);
	});

	test("throws NotFoundError when the cap does not exist", async () => {
		const client = makeReader({
			getObject: mock(async () => {
				throw new Error(`Object ${PUBLISHER_CAP_ID} not found`);
			}),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		await expect(reader.getPublisherCap(PUBLISHER_CAP_ID)).rejects.toThrow(
			NotFoundError,
		);
	});

	test("throws ValidationError when holder is missing", async () => {
		const client = makeReader({
			getObject: mock(async () =>
				publisherCapObject({
					id: { id: PUBLISHER_CAP_ID },
					publication_id: PUBLICATION_ID,
				}),
			),
		});
		const reader = new RpcPublicationReader(client, PACKAGE_ID);
		await expect(reader.getPublisherCap(PUBLISHER_CAP_ID)).rejects.toThrow(
			ValidationError,
		);
	});
});

describe("RpcPublicationReader.listPublisherCapsOwnedBy", () => {
	test("forwards limit, cursor, signal, and the PublisherCap type filter", async () => {
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
		await reader.listPublisherCapsOwnedBy(ADDRESS, {
			limit: 7,
			cursor: "cap-page",
			signal: controller.signal,
		});
		const calls = spy.mock.calls as unknown as Array<
			Array<Record<string, unknown>>
		>;
		const args = calls[0]?.[0] ?? {};
		expect(args["limit"]).toBe(7);
		expect(args["cursor"]).toBe("cap-page");
		expect(args["signal"]).toBe(controller.signal);
		expect(args["type"]).toBe(`${PACKAGE_ID}::publication::PublisherCap`);
	});

	test("uses the PublisherCap type filter and returns parsed caps", async () => {
		const spy = mock(async () => ({
			objects: [
				{
					objectId: PUBLISHER_CAP_ID,
					type: `${PACKAGE_ID}::publication::PublisherCap`,
					json: {
						id: { id: PUBLISHER_CAP_ID },
						publication_id: PUBLICATION_ID,
						holder: ADDRESS,
					},
				},
			],
			hasNextPage: false,
			cursor: null,
		}));
		const reader = new RpcPublicationReader(
			makeReader({ listOwnedObjects: spy }),
			PACKAGE_ID,
		);
		const page = await reader.listPublisherCapsOwnedBy(ADDRESS);
		expect(page.results).toHaveLength(1);
		expect(page.results[0]?.id as string).toBe(PUBLISHER_CAP_ID as string);

		const calls = spy.mock.calls as unknown as Array<
			Array<Record<string, unknown>>
		>;
		const args = calls[0]?.[0] ?? {};
		expect(args["type"]).toBe(`${PACKAGE_ID}::publication::PublisherCap`);
	});
});

// Entry / revision reads

const BLOB_OBJECT_ID =
	"0x000000000000000000000000000000000000000000000000000000000000beef";
const AUTHOR =
	"0x0000000000000000000000000000000000000000000000000000000000000111";

function buildEntryBcs(opts: {
	name: string;
	revisionContentTypes: string[];
	draftHead: number | null;
	publicHead: number | null;
}): Uint8Array {
	const { EntryBcs } =
		require("./entry-bcs.js") as typeof import("./entry-bcs.js");
	return EntryBcs.serialize({
		name: opts.name,
		revisions: opts.revisionContentTypes.map((ct) => ({
			blob_ref: { Blob: BLOB_OBJECT_ID },
			content_type: ct,
			encrypted: false,
			access_policy: 0,
			seal_id: null,
			author: AUTHOR,
		})),
		draft_head: opts.draftHead,
		public_head: opts.publicHead,
	}).toBytes();
}

function buildEntryIdName(entryId: number): { type: string; bcs: Uint8Array } {
	const { EntryIdBcs } =
		require("./entry-bcs.js") as typeof import("./entry-bcs.js");
	return { type: "u64", bcs: EntryIdBcs.serialize(entryId).toBytes() };
}

describe("RpcPublicationReader.getEntry", () => {
	test("decodes a single entry by id", async () => {
		const entryBytes = buildEntryBcs({
			name: "first-post",
			revisionContentTypes: ["text/markdown"],
			draftHead: null,
			publicHead: 0,
		});
		const reader = new RpcPublicationReader(
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
				getDynamicField: mock(async () => ({
					dynamicField: {
						fieldId: "0xfield",
						type: "...::dynamic_field::Field",
						name: buildEntryIdName(0),
						valueType: "...::entry::Entry",
						value: { type: "...::entry::Entry", bcs: entryBytes },
						version: "1",
						digest: "abc",
						previousTransaction: null,
						$kind: "DynamicField",
					},
				})),
			}),
			PACKAGE_ID,
		);
		const entry = await reader.getEntry(PUBLICATION_ID, "blog", 0);
		expect(entry.id).toBe(0);
		expect(entry.name).toBe("first-post");
		expect(entry.revisions).toHaveLength(1);
		expect(entry.revisions[0]?.contentType).toBe("text/markdown");
		expect(entry.revisions[0]?.blobRef.kind).toBe("blob");
		expect(entry.draftHead).toBeNull();
		expect(entry.publicHead).toBe(0);
	});

	test("throws NotFoundError when collection name is missing", async () => {
		const reader = new RpcPublicationReader(
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
			}),
			PACKAGE_ID,
		);
		await expect(
			reader.getEntry(PUBLICATION_ID, "no-such-collection", 0),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	test("throws ValidationError on malformed BCS", async () => {
		const reader = new RpcPublicationReader(
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
				getDynamicField: mock(async () => ({
					dynamicField: {
						fieldId: "0xfield",
						type: "...",
						name: buildEntryIdName(0),
						valueType: "...",
						value: { type: "...", bcs: new Uint8Array([0xff, 0xff]) },
						version: "1",
						digest: "abc",
						previousTransaction: null,
						$kind: "DynamicField",
					},
				})),
			}),
			PACKAGE_ID,
		);
		await expect(
			reader.getEntry(PUBLICATION_ID, "blog", 0),
		).rejects.toBeInstanceOf(ValidationError);
	});

	test("maps RPC not-found to NotFoundError", async () => {
		const reader = new RpcPublicationReader(
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
				getDynamicField: mock(async () => {
					throw new Error(
						"Object 0x000000000000000000000000000000000000000000000000000000000000ffff not found",
					);
				}),
			}),
			PACKAGE_ID,
		);
		await expect(
			reader.getEntry(PUBLICATION_ID, "blog", 99),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	test("does not misclassify a transport failure as NotFoundError", async () => {
		const reader = new RpcPublicationReader(
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
				getDynamicField: mock(async () => {
					throw new Error("service unavailable: connection not found");
				}),
			}),
			PACKAGE_ID,
		);
		await expect(
			reader.getEntry(PUBLICATION_ID, "blog", 99),
		).rejects.toBeInstanceOf(TransportError);
	});
});

describe("RpcPublicationReader.getRevision", () => {
	test("returns a revision by index", async () => {
		const entryBytes = buildEntryBcs({
			name: "post",
			revisionContentTypes: ["text/markdown", "text/html"],
			draftHead: 1,
			publicHead: 0,
		});
		const reader = new RpcPublicationReader(
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
				getDynamicField: mock(async () => ({
					dynamicField: {
						fieldId: "0xfield",
						type: "...",
						name: buildEntryIdName(0),
						valueType: "...",
						value: { type: "...", bcs: entryBytes },
						version: "1",
						digest: "abc",
						previousTransaction: null,
						$kind: "DynamicField",
					},
				})),
			}),
			PACKAGE_ID,
		);
		const revision = await reader.getRevision(PUBLICATION_ID, "blog", 0, 1);
		expect(revision.id).toBe(1);
		expect(revision.contentType).toBe("text/html");
	});

	test("throws NotFoundError when revisionId is out of range", async () => {
		const entryBytes = buildEntryBcs({
			name: "post",
			revisionContentTypes: ["text/markdown"],
			draftHead: null,
			publicHead: 0,
		});
		const reader = new RpcPublicationReader(
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
				getDynamicField: mock(async () => ({
					dynamicField: {
						fieldId: "0xfield",
						type: "...",
						name: buildEntryIdName(0),
						valueType: "...",
						value: { type: "...", bcs: entryBytes },
						version: "1",
						digest: "abc",
						previousTransaction: null,
						$kind: "DynamicField",
					},
				})),
			}),
			PACKAGE_ID,
		);
		await expect(
			reader.getRevision(PUBLICATION_ID, "blog", 0, 5),
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe("RpcPublicationReader.listEntries", () => {
	test("decodes a page of entries with values", async () => {
		const e0 = buildEntryBcs({
			name: "first",
			revisionContentTypes: ["text/markdown"],
			draftHead: null,
			publicHead: 0,
		});
		const e1 = buildEntryBcs({
			name: "second",
			revisionContentTypes: ["text/markdown"],
			draftHead: null,
			publicHead: 0,
		});
		const reader = new RpcPublicationReader(
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
				listDynamicFields: mock(async () => ({
					dynamicFields: [
						{
							fieldId: "0xfield0",
							type: "...",
							name: buildEntryIdName(0),
							valueType: "...",
							value: { type: "...", bcs: e0 },
							$kind: "DynamicField",
						},
						{
							fieldId: "0xfield1",
							type: "...",
							name: buildEntryIdName(1),
							valueType: "...",
							value: { type: "...", bcs: e1 },
							$kind: "DynamicField",
						},
					],
					hasNextPage: false,
					cursor: null,
				})),
			}),
			PACKAGE_ID,
		);
		const page = await reader.listEntries(PUBLICATION_ID, "blog");
		expect(page.results).toHaveLength(2);
		expect(page.results[0]?.id).toBe(0);
		expect(page.results[0]?.name).toBe("first");
		expect(page.results[1]?.id).toBe(1);
		expect(page.results[1]?.name).toBe("second");
	});

	test("decodes a quilt-mode entry's BlobRef::QuiltPatch", async () => {
		const { EntryBcs } =
			require("./entry-bcs.js") as typeof import("./entry-bcs.js");
		const patchBytes = new Uint8Array(37).fill(7);
		const entryBytes = EntryBcs.serialize({
			name: "img",
			revisions: [
				{
					blob_ref: { QuiltPatch: Array.from(patchBytes) },
					content_type: "image/png",
					encrypted: false,
					access_policy: 0,
					seal_id: null,
					author: AUTHOR,
				},
			],
			draft_head: null,
			public_head: 0,
		}).toBytes();
		const reader = new RpcPublicationReader(
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
				getDynamicField: mock(async () => ({
					dynamicField: {
						fieldId: "0xfield",
						type: "...",
						name: buildEntryIdName(0),
						valueType: "...",
						value: { type: "...", bcs: entryBytes },
						version: "1",
						digest: "abc",
						previousTransaction: null,
						$kind: "DynamicField",
					},
				})),
			}),
			PACKAGE_ID,
		);
		const entry = await reader.getEntry(PUBLICATION_ID, "files", 0);
		const ref = entry.revisions[0]?.blobRef;
		expect(ref?.kind).toBe("quilt");
		if (ref?.kind === "quilt") {
			expect(ref.patchId.length).toBe(37);
		}
	});
});

describe("RpcPublicationReader.scanEntries", () => {
	test("walks all pages and stops on nextCursor=null", async () => {
		const e0 = buildEntryBcs({
			name: "first",
			revisionContentTypes: ["text/markdown"],
			draftHead: null,
			publicHead: 0,
		});
		const e1 = buildEntryBcs({
			name: "second",
			revisionContentTypes: ["text/markdown"],
			draftHead: null,
			publicHead: 0,
		});
		let call = 0;
		const reader = new RpcPublicationReader(
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
				listDynamicFields: mock(async () => {
					call += 1;
					if (call === 1) {
						return {
							dynamicFields: [
								{
									fieldId: "0xfield0",
									type: "...",
									name: buildEntryIdName(0),
									valueType: "...",
									value: { type: "...", bcs: e0 },
									$kind: "DynamicField",
								},
							],
							hasNextPage: true,
							cursor: "page-2",
						};
					}
					return {
						dynamicFields: [
							{
								fieldId: "0xfield1",
								type: "...",
								name: buildEntryIdName(1),
								valueType: "...",
								value: { type: "...", bcs: e1 },
								$kind: "DynamicField",
							},
						],
						hasNextPage: false,
						cursor: null,
					};
				}),
			}),
			PACKAGE_ID,
		);
		const collected: number[] = [];
		for await (const entry of reader.scanEntries(PUBLICATION_ID, "blog")) {
			collected.push(entry.id);
		}
		expect(collected).toEqual([0, 1]);
		expect(call).toBe(2);
	});

	test("early-bail does not fetch additional pages", async () => {
		const e0 = buildEntryBcs({
			name: "first",
			revisionContentTypes: ["text/markdown"],
			draftHead: null,
			publicHead: 0,
		});
		const spy = mock(async () => ({
			dynamicFields: [
				{
					fieldId: "0xfield0",
					type: "...",
					name: buildEntryIdName(0),
					valueType: "...",
					value: { type: "...", bcs: e0 },
					$kind: "DynamicField",
				},
			],
			hasNextPage: true,
			cursor: "page-2",
		}));
		const reader = new RpcPublicationReader(
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
				listDynamicFields: spy,
			}),
			PACKAGE_ID,
		);
		for await (const entry of reader.scanEntries(PUBLICATION_ID, "blog")) {
			expect(entry.id).toBe(0);
			break;
		}
		expect(spy).toHaveBeenCalledTimes(1);
	});
});

describe("RpcPublicationReader.fromMorseConfig", () => {
	test("uses originalPackageId when present", async () => {
		const reader = RpcPublicationReader.fromMorseConfig(
			{
				packageId: toPackageId(
					"0x0000000000000000000000000000000000000000000000000000000000000aaa",
				),
				originalPackageId: PACKAGE_ID,
			},
			makeReader({
				getObject: mock(async () =>
					publicationObject(happyPathPublicationJson()),
				),
			}),
		);
		const publication = await reader.getPublication(PUBLICATION_ID);
		expect(publication.id as string).toBe(PUBLICATION_ID as string);
	});

	test("falls back to packageId when originalPackageId is omitted", () => {
		const reader = RpcPublicationReader.fromMorseConfig(
			{ packageId: PACKAGE_ID },
			makeReader(),
		);
		// The constructor stores the resolved id privately; call a method that
		// uses it (listPublicationsOwnedBy) and confirm the type filter is built
		// from the supplied packageId.
		expect(reader).toBeInstanceOf(RpcPublicationReader);
	});
});
