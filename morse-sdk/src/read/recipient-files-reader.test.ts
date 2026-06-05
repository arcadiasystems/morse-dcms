import { describe, expect, mock, test } from "bun:test";

import type { ObjectReader } from "../clients.js";
import { toPackageId, toRecipientFileId, toSuiAddress } from "../codecs.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { RpcRecipientFilesReader } from "./recipient-files-reader.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const FILE_ID = toRecipientFileId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const OWNER = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000cccc",
);
const MEMBER = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000dddd",
);

// 32 zero bytes encoded as standard base64 then URL-safe form (no padding).
const ZERO_BLOB_ID_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function fileResponse(jsonOverrides: Partial<Record<string, unknown>> = {}) {
	const base = {
		// blob_id as base64-encoded 32 zero bytes (Sui's string-encoded byte vector form).
		blob_id: btoa("\0".repeat(32)),
		blob_object_id: { vec: [] },
		owner: OWNER,
		name: "doc.pdf",
		content_type: "application/pdf",
		size: "1234",
		members: { contents: [OWNER, MEMBER] },
		created_at_ms: "1700000000000",
		...jsonOverrides,
	};
	return {
		object: {
			objectId: FILE_ID,
			version: "1",
			digest: "abc",
			owner: { $kind: "Shared", Shared: { initialSharedVersion: "1" } },
			json: base,
		},
	};
}

function makeReader(
	getObject: (...args: unknown[]) => Promise<unknown>,
): ObjectReader {
	return {
		getObject,
		listOwnedObjects: mock(async () => ({
			objects: [],
			hasNextPage: false,
			cursor: null,
		})),
		listDynamicFields: mock(async () => ({
			dynamicFields: [],
			hasNextPage: false,
			cursor: null,
		})),
		getDynamicField: mock(async () => {
			throw new Error("not stubbed");
		}),
	} as unknown as ObjectReader;
}

describe("RpcRecipientFilesReader.getRecipientFile", () => {
	test("parses a happy-path RecipientFile", async () => {
		const reader = RpcRecipientFilesReader.fromConfig(
			makeReader(async () => fileResponse()),
			{ packageId: PACKAGE_ID },
		);
		const result = await reader.getRecipientFile(FILE_ID);
		expect(result.id as string).toBe(FILE_ID as string);
		expect(result.owner).toBe(OWNER);
		expect(result.name).toBe("doc.pdf");
		expect(result.contentType).toBe("application/pdf");
		expect(result.size).toBe(1234);
		expect(result.members).toEqual([OWNER, MEMBER]);
		expect(result.blobObjectId).toBe(null);
		expect(result.blobId).toBe(ZERO_BLOB_ID_B64 as never);
		expect(result.createdAtMs).toBe(1700000000000);
	});

	test("parses blob_id when serialized as a number array (alternate Sui encoding)", async () => {
		const reader = RpcRecipientFilesReader.fromConfig(
			makeReader(async () =>
				fileResponse({
					blob_id: new Array(32).fill(0),
				}),
			),
			{ packageId: PACKAGE_ID },
		);
		const result = await reader.getRecipientFile(FILE_ID);
		expect(result.blobId).toBe(ZERO_BLOB_ID_B64 as never);
	});

	test("parses blob_object_id from the JSON-RPC Option shape ({ vec: [id] })", async () => {
		const blobObjectId =
			"0x0000000000000000000000000000000000000000000000000000000000000abc";
		const reader = RpcRecipientFilesReader.fromConfig(
			makeReader(async () =>
				fileResponse({ blob_object_id: { vec: [blobObjectId] } }),
			),
			{ packageId: PACKAGE_ID },
		);
		const result = await reader.getRecipientFile(FILE_ID);
		expect(result.blobObjectId as string).toBe(blobObjectId);
	});

	test("parses blob_object_id from the gRPC Option shape (bare string)", async () => {
		// Regression: SuiGrpcClient encodes Some(ID) as a bare hex string,
		// not as { vec: [...] }. Pre-0.4.2 the reader rejected this and
		// broke every download path against a gRPC client. Any RecipientFile
		// created by the upload helpers carries a Some blob_object_id.
		const blobObjectId =
			"0x1d293d56066e73d6eea45832f1f359cb32b534dcb8af07124d41847fa4e2e992";
		const reader = RpcRecipientFilesReader.fromConfig(
			makeReader(async () => fileResponse({ blob_object_id: blobObjectId })),
			{ packageId: PACKAGE_ID },
		);
		const result = await reader.getRecipientFile(FILE_ID);
		expect(result.blobObjectId as string).toBe(blobObjectId);
	});

	test("parses blob_object_id absent (null) as null", async () => {
		const reader = RpcRecipientFilesReader.fromConfig(
			makeReader(async () => fileResponse({ blob_object_id: null })),
			{ packageId: PACKAGE_ID },
		);
		const result = await reader.getRecipientFile(FILE_ID);
		expect(result.blobObjectId).toBe(null);
	});

	test("throws NotFoundError when the object envelope has no json", async () => {
		const reader = RpcRecipientFilesReader.fromConfig(
			makeReader(async () => ({
				object: {
					objectId: FILE_ID,
					version: "1",
					digest: "abc",
					owner: { $kind: "Shared", Shared: { initialSharedVersion: "1" } },
					json: null,
				},
			})),
			{ packageId: PACKAGE_ID },
		);
		await expect(reader.getRecipientFile(FILE_ID)).rejects.toBeInstanceOf(
			NotFoundError,
		);
	});

	test("throws NotFoundError when getObject surfaces the gRPC not-found message", async () => {
		const reader = RpcRecipientFilesReader.fromConfig(
			makeReader(async () => {
				throw new Error(`Object ${FILE_ID} not found`);
			}),
			{ packageId: PACKAGE_ID },
		);
		await expect(reader.getRecipientFile(FILE_ID)).rejects.toBeInstanceOf(
			NotFoundError,
		);
	});

	test("throws ValidationError when blob_id decodes to the wrong length", async () => {
		const reader = RpcRecipientFilesReader.fromConfig(
			makeReader(async () => fileResponse({ blob_id: btoa("\0".repeat(16)) })),
			{ packageId: PACKAGE_ID },
		);
		await expect(reader.getRecipientFile(FILE_ID)).rejects.toBeInstanceOf(
			ValidationError,
		);
	});

	test("throws ValidationError when members is malformed", async () => {
		const reader = RpcRecipientFilesReader.fromConfig(
			makeReader(async () =>
				fileResponse({ members: { contents: "not-array" } }),
			),
			{ packageId: PACKAGE_ID },
		);
		await expect(reader.getRecipientFile(FILE_ID)).rejects.toBeInstanceOf(
			ValidationError,
		);
	});
});
