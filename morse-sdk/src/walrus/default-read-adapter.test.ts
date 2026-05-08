import { describe, expect, mock, test } from "bun:test";
import {
	NoBlobMetadataReceivedError,
	type WalrusFile,
	NotFoundError as WalrusNotFoundError,
} from "@mysten/walrus";

import { toBlobObjectId, toQuiltPatchId, toWalrusBlobId } from "../codecs.js";
import { NotFoundError, TransportError } from "../errors.js";
import { QUILT_PATCH_ID_LENGTH } from "../types.js";
import { DefaultWalrusReadAdapter } from "./default-read-adapter.js";

const SAMPLE_BLOB_ID = toWalrusBlobId(
	"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
);
const SUI_OBJECT_ID = toBlobObjectId(
	"0xd1dd47c84e7c2f217a8b5a4fcec849a3b985df4fada82f72b72602423d8d018e",
);
const PATCH_ID = toQuiltPatchId(new Uint8Array(QUILT_PATCH_ID_LENGTH).fill(7));

interface FakeReadClient {
	readBlob(args: { blobId: string; signal?: AbortSignal }): Promise<Uint8Array>;
	getBlobObject(blobObjectId: string): Promise<{ id: string; blob_id: string }>;
	getFiles(args: { ids: string[] }): Promise<WalrusFile[]>;
}

function fakeFile(bytes: Uint8Array): WalrusFile {
	return {
		bytes: async () => bytes,
	} as unknown as WalrusFile;
}

function fakeClient(overrides: Partial<FakeReadClient> = {}): {
	client: FakeReadClient;
	calls: { readBlob: unknown[]; getBlobObject: unknown[]; getFiles: unknown[] };
} {
	const calls = {
		readBlob: [] as unknown[],
		getBlobObject: [] as unknown[],
		getFiles: [] as unknown[],
	};
	const client: FakeReadClient = {
		readBlob: async (args) => {
			calls.readBlob.push(args);
			if (overrides.readBlob) return overrides.readBlob(args);
			return new Uint8Array([0xde, 0xad]);
		},
		getBlobObject: async (objectId) => {
			calls.getBlobObject.push(objectId);
			if (overrides.getBlobObject) return overrides.getBlobObject(objectId);
			return { id: objectId, blob_id: SAMPLE_BLOB_ID };
		},
		getFiles: async (args) => {
			calls.getFiles.push(args);
			if (overrides.getFiles) return overrides.getFiles(args);
			return [fakeFile(new Uint8Array([0xfe, 0xed]))];
		},
	};
	return { client, calls };
}

describe("DefaultWalrusReadAdapter.readBlob", () => {
	test("forwards content blobId to WalrusClient.readBlob", async () => {
		const { client, calls } = fakeClient();
		const adapter = new DefaultWalrusReadAdapter({ client });
		const out = await adapter.readBlob(SAMPLE_BLOB_ID);
		expect(Array.from(out)).toEqual([0xde, 0xad]);
		const args = calls.readBlob[0] as { blobId: string };
		expect(args.blobId).toBe(SAMPLE_BLOB_ID);
	});

	test("propagates the AbortSignal", async () => {
		const { client, calls } = fakeClient();
		const adapter = new DefaultWalrusReadAdapter({ client });
		const signal = new AbortController().signal;
		await adapter.readBlob(SAMPLE_BLOB_ID, { signal });
		const args = calls.readBlob[0] as { signal?: AbortSignal };
		expect(args.signal).toBe(signal);
	});

	test("wraps unknown errors as TransportError", async () => {
		const { client } = fakeClient({
			readBlob: async () => {
				throw new Error("network down");
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		await expect(adapter.readBlob(SAMPLE_BLOB_ID)).rejects.toBeInstanceOf(
			TransportError,
		);
	});
});

describe("DefaultWalrusReadAdapter.readBlobByObjectId", () => {
	test("resolves the Sui object to a blob_id then reads the bytes", async () => {
		const { client, calls } = fakeClient({
			getBlobObject: async () => ({
				id: SUI_OBJECT_ID,
				blob_id: SAMPLE_BLOB_ID,
			}),
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		const out = await adapter.readBlobByObjectId(SUI_OBJECT_ID);
		expect(Array.from(out)).toEqual([0xde, 0xad]);
		expect(calls.getBlobObject[0]).toBe(SUI_OBJECT_ID);
		const readArgs = calls.readBlob[0] as { blobId: string };
		expect(readArgs.blobId).toBe(SAMPLE_BLOB_ID);
	});

	test("maps Walrus NotFoundError on the object lookup to morse NotFoundError", async () => {
		const { client } = fakeClient({
			getBlobObject: async () => {
				throw new WalrusNotFoundError(404, undefined, "object not found");
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		await expect(
			adapter.readBlobByObjectId(SUI_OBJECT_ID),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	test("maps NoBlobMetadataReceivedError to NotFoundError", async () => {
		const { client } = fakeClient({
			readBlob: async () => {
				throw new NoBlobMetadataReceivedError("blob not certified");
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		await expect(
			adapter.readBlobByObjectId(SUI_OBJECT_ID),
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe("DefaultWalrusReadAdapter.readQuiltPatch", () => {
	test("encodes the patch id and reads via getFiles", async () => {
		const { client, calls } = fakeClient();
		const adapter = new DefaultWalrusReadAdapter({ client });
		const out = await adapter.readQuiltPatch(PATCH_ID);
		expect(Array.from(out)).toEqual([0xfe, 0xed]);
		const args = calls.getFiles[0] as { ids: string[] };
		expect(args.ids).toHaveLength(1);
		expect(typeof args.ids[0]).toBe("string");
	});

	test("throws TransportError when getFiles returns nothing", async () => {
		const { client } = fakeClient({
			getFiles: async () => [],
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		await expect(adapter.readQuiltPatch(PATCH_ID)).rejects.toBeInstanceOf(
			TransportError,
		);
	});
});

describe("DefaultWalrusReadAdapter.readBlobRef", () => {
	test("dispatches to readBlobByObjectId for blob-mode refs", async () => {
		const { client } = fakeClient();
		const adapter = new DefaultWalrusReadAdapter({ client });
		const out = await adapter.readBlobRef({
			kind: "blob",
			blobObjectId: SUI_OBJECT_ID,
		});
		expect(Array.from(out)).toEqual([0xde, 0xad]);
	});

	test("dispatches to readQuiltPatch for quilt refs", async () => {
		const { client } = fakeClient();
		const adapter = new DefaultWalrusReadAdapter({ client });
		const out = await adapter.readBlobRef({
			kind: "quilt",
			patchId: PATCH_ID,
		});
		expect(Array.from(out)).toEqual([0xfe, 0xed]);
	});
});

// Touch `mock` to keep the import alive for future test additions.
mock.module;
