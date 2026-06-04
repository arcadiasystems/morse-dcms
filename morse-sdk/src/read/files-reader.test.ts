import { describe, expect, mock, test } from "bun:test";

import type { ObjectReader } from "../clients.js";
import {
	toAllowlistId,
	toEncryptedFileId,
	toPackageId,
	toSuiAddress,
} from "../codecs.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { RpcFilesReader } from "./files-reader.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const ALLOWLIST_ID = toAllowlistId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const FILE_ID = toEncryptedFileId(
	"0x000000000000000000000000000000000000000000000000000000000000cafe",
);
const OWNER = toSuiAddress(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);

function makeReader(
	overrides: Partial<{
		getObject: (...args: unknown[]) => Promise<unknown>;
		listOwnedObjects: (...args: unknown[]) => Promise<unknown>;
	}> = {},
): ObjectReader {
	return {
		getObject: overrides.getObject ?? mock(async () => ({ object: null })),
		listOwnedObjects:
			overrides.listOwnedObjects ??
			mock(async () => ({ objects: [], hasNextPage: false, cursor: null })),
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

function fileObject(jsonOverrides: Record<string, unknown> = {}) {
	return {
		object: {
			objectId: FILE_ID,
			version: "1",
			digest: "abc",
			owner: { $kind: "Shared", Shared: { initialSharedVersion: "1" } },
			type: `${PACKAGE_ID}::file::EncryptedFile`,
			json: {
				id: { id: FILE_ID },
				owner: OWNER,
				blob_id: "MSNyyOxt2LHzWKwzUEmfx-w3BDjtJjLBdcGMuTSrLrw",
				blob_object_id: null,
				name: "secret.pdf",
				content_type: "application/pdf",
				size: "1234",
				encrypted: true,
				allowlist_id: ALLOWLIST_ID,
				created_at_ms: "1780561245030",
				...jsonOverrides,
			},
		},
	};
}

describe("RpcFilesReader.getEncryptedFile", () => {
	test("parses blob_id when serialized as URL-safe base64 string (modern Sui RPC)", async () => {
		const client = makeReader({
			getObject: mock(async () => fileObject()),
		});
		const reader = new RpcFilesReader(client, PACKAGE_ID);
		const file = await reader.getEncryptedFile(FILE_ID);
		expect(file.blobId as string).toBe(
			"MSNyyOxt2LHzWKwzUEmfx-w3BDjtJjLBdcGMuTSrLrw",
		);
		expect(file.encrypted).toBe(true);
		expect(file.allowlistId).toBe(ALLOWLIST_ID);
	});

	test("parses blob_id when serialized as a number array (older Sui RPC)", async () => {
		// 32 bytes -> base64URL "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
		const blobIdBytes = new Array(32).fill(0);
		const client = makeReader({
			getObject: mock(async () => fileObject({ blob_id: blobIdBytes })),
		});
		const reader = new RpcFilesReader(client, PACKAGE_ID);
		const file = await reader.getEncryptedFile(FILE_ID);
		expect((file.blobId as string).length).toBe(43);
	});

	test("parses blob_id with standard (non-URL-safe) base64", async () => {
		// + and / chars should be converted to - and _, padding stripped.
		// Use a 43-char base64 (32 bytes) that toWalrusBlobId accepts.
		// Construct a string with both + and / to exercise the conversion.
		const standardB64 = "abc+def/ghijklmnopqrstuvwxyzABCDEFGHIJKLMNO";
		// 43 chars
		const expected = "abc-def_ghijklmnopqrstuvwxyzABCDEFGHIJKLMNO";
		const client = makeReader({
			getObject: mock(async () => fileObject({ blob_id: standardB64 })),
		});
		const reader = new RpcFilesReader(client, PACKAGE_ID);
		const file = await reader.getEncryptedFile(FILE_ID);
		expect(file.blobId as string).toBe(expected);
	});

	test("rejects malformed blob_id", async () => {
		const client = makeReader({
			getObject: mock(async () => fileObject({ blob_id: "not!valid!base64" })),
		});
		const reader = new RpcFilesReader(client, PACKAGE_ID);
		await expect(reader.getEncryptedFile(FILE_ID)).rejects.toBeInstanceOf(
			ValidationError,
		);
	});

	test("throws NotFoundError with resource='encrypted-file' when not found", async () => {
		const client = makeReader({
			getObject: mock(async () => ({ object: null })),
		});
		const reader = new RpcFilesReader(client, PACKAGE_ID);
		try {
			await reader.getEncryptedFile(FILE_ID);
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(NotFoundError);
			expect((error as NotFoundError).resource).toBe("encrypted-file");
		}
	});

	test("fails fast on malformed file id before any RPC", async () => {
		const getObject = mock(async () => ({ object: null }));
		const client = makeReader({ getObject });
		const reader = new RpcFilesReader(client, PACKAGE_ID);
		await expect(
			reader.getEncryptedFile("not-an-id" as unknown as typeof FILE_ID),
		).rejects.toBeInstanceOf(ValidationError);
		expect(getObject).not.toHaveBeenCalled();
	});
});

describe("RpcFilesReader.getAllowlist", () => {
	function allowlistObject(jsonOverrides: Record<string, unknown> = {}) {
		return {
			object: {
				objectId: ALLOWLIST_ID,
				version: "1",
				digest: "abc",
				owner: { $kind: "Shared", Shared: { initialSharedVersion: "1" } },
				type: `${PACKAGE_ID}::allowlist::Allowlist`,
				json: {
					id: { id: ALLOWLIST_ID },
					name: "team-docs",
					members: {
						contents: [OWNER],
					},
					...jsonOverrides,
				},
			},
		};
	}

	test("parses name and members", async () => {
		const client = makeReader({
			getObject: mock(async () => allowlistObject()),
		});
		const reader = new RpcFilesReader(client, PACKAGE_ID);
		const allowlist = await reader.getAllowlist(ALLOWLIST_ID);
		expect(allowlist.name).toBe("team-docs");
		expect(allowlist.members).toEqual([OWNER]);
	});

	test("throws NotFoundError with resource='allowlist' when not found", async () => {
		const client = makeReader({
			getObject: mock(async () => ({ object: null })),
		});
		const reader = new RpcFilesReader(client, PACKAGE_ID);
		try {
			await reader.getAllowlist(ALLOWLIST_ID);
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(NotFoundError);
			expect((error as NotFoundError).resource).toBe("allowlist");
		}
	});

	test("returns empty members when contents missing", async () => {
		const client = makeReader({
			getObject: mock(async () =>
				allowlistObject({ members: { contents: undefined } }),
			),
		});
		const reader = new RpcFilesReader(client, PACKAGE_ID);
		const allowlist = await reader.getAllowlist(ALLOWLIST_ID);
		expect(allowlist.members).toEqual([]);
	});
});
