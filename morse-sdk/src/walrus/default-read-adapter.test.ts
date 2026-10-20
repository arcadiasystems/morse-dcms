import { describe, expect, mock, test } from "bun:test";
import {
	BlobNotCertifiedError,
	blobIdFromInt,
	NoBlobMetadataReceivedError,
	type WalrusFile,
	NotFoundError as WalrusNotFoundError,
} from "@mysten/walrus";

import { toBlobObjectId, toQuiltPatchId, toWalrusBlobId } from "../codecs.js";
import {
	BlobExpiredError,
	NotFoundError,
	TransportError,
	ValidationError,
} from "../errors.js";
import { QUILT_PATCH_ID_LENGTH } from "../types.js";
import { DefaultWalrusReadAdapter } from "./default-read-adapter.js";
import { quiltPatchIdToString } from "./quilt-patch-id.js";

const SAMPLE_BLOB_ID = toWalrusBlobId(
	"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
);
// `getBlobObject` returns `blob_id` as Sui decodes a Move u256: a decimal
// string, never the base64 form. This one is a real testnet Blob object's.
const ON_CHAIN_BLOB_ID =
	"76712379166943265631249750039322264804099220978611039441823192841119112366022";
const SUI_OBJECT_ID = toBlobObjectId(
	"0xd1dd47c84e7c2f217a8b5a4fcec849a3b985df4fada82f72b72602423d8d018e",
);
const PATCH_ID = toQuiltPatchId(new Uint8Array(QUILT_PATCH_ID_LENGTH).fill(7));
const CURRENT_EPOCH = 10;
const LIVE_END_EPOCH = 20;
const READ_BLOB_ID = blobIdFromInt(BigInt(ON_CHAIN_BLOB_ID));

interface FakeBlobObject {
	id: string;
	blob_id: string;
	certified_epoch: number | null;
	storage: { end_epoch: number };
}

interface FakeReadClient {
	readBlob(args: { blobId: string; signal?: AbortSignal }): Promise<Uint8Array>;
	getBlobObject(blobObjectId: string): Promise<FakeBlobObject>;
	getFiles(args: { ids: string[] }): Promise<WalrusFile[]>;
	systemState(): Promise<{ committee: { epoch: number } }>;
}

function blobObject(overrides: Partial<FakeBlobObject> = {}): FakeBlobObject {
	return {
		id: SUI_OBJECT_ID,
		blob_id: ON_CHAIN_BLOB_ID,
		certified_epoch: 3,
		storage: { end_epoch: LIVE_END_EPOCH },
		...overrides,
	};
}

async function readFailure(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the read to fail");
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
			return blobObject({ id: objectId });
		},
		getFiles: async (args) => {
			calls.getFiles.push(args);
			if (overrides.getFiles) return overrides.getFiles(args);
			return [fakeFile(new Uint8Array([0xfe, 0xed]))];
		},
		systemState: async () => {
			if (overrides.systemState) return overrides.systemState();
			return { committee: { epoch: CURRENT_EPOCH } };
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

	test("treats no metadata from any node as a TransportError naming the blob", async () => {
		const { client } = fakeClient({
			readBlob: async () => {
				throw new NoBlobMetadataReceivedError(
					"No valid blob metadata could be retrieved from any storage node.",
				);
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		const error = await readFailure(adapter.readBlob(SAMPLE_BLOB_ID));
		expect(error).toBeInstanceOf(TransportError);
		expect(error).not.toBeInstanceOf(NotFoundError);
		expect((error as TransportError).operation).toBe("walrus.readBlob");
		expect((error as TransportError).message).toContain(SAMPLE_BLOB_ID);
	});

	test("maps a quorum reporting the blob uncertified to NotFoundError keyed by the blob id", async () => {
		const { client } = fakeClient({
			readBlob: async () => {
				throw new BlobNotCertifiedError("The blob does not exist.");
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		const error = await readFailure(adapter.readBlob(SAMPLE_BLOB_ID));
		expect(error).toBeInstanceOf(NotFoundError);
		expect((error as NotFoundError).resource).toBe("blob");
		expect((error as NotFoundError).identifier).toBe(SAMPLE_BLOB_ID);
	});
});

describe("DefaultWalrusReadAdapter.readBlobByObjectId", () => {
	test("converts the on-chain u256 blob_id to the base64url id before reading", async () => {
		const { client, calls } = fakeClient();
		const adapter = new DefaultWalrusReadAdapter({ client });
		const out = await adapter.readBlobByObjectId(SUI_OBJECT_ID);
		expect(Array.from(out)).toEqual([0xde, 0xad]);
		expect(calls.getBlobObject[0]).toBe(SUI_OBJECT_ID);
		const readArgs = calls.readBlob[0] as { blobId: string };
		expect(readArgs.blobId).toBe(blobIdFromInt(BigInt(ON_CHAIN_BLOB_ID)));
	});

	test("propagates the AbortSignal to the blob read", async () => {
		const { client, calls } = fakeClient();
		const adapter = new DefaultWalrusReadAdapter({ client });
		const signal = new AbortController().signal;
		await adapter.readBlobByObjectId(SUI_OBJECT_ID, { signal });
		const readArgs = calls.readBlob[0] as { signal?: AbortSignal };
		expect(readArgs.signal).toBe(signal);
	});

	test("rejects a blob_id that is not a u256 with ValidationError, without reading", async () => {
		const { client, calls } = fakeClient({
			getBlobObject: async () => blobObject({ blob_id: "not-a-u256" }),
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		await expect(
			adapter.readBlobByObjectId(SUI_OBJECT_ID),
		).rejects.toBeInstanceOf(ValidationError);
		expect(calls.readBlob).toHaveLength(0);
	});

	test("maps Walrus NotFoundError on the object lookup to morse NotFoundError", async () => {
		const { client } = fakeClient({
			getBlobObject: async () => {
				throw new WalrusNotFoundError(404, undefined, "object not found");
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		const error = await readFailure(adapter.readBlobByObjectId(SUI_OBJECT_ID));
		expect(error).toBeInstanceOf(NotFoundError);
		expect((error as NotFoundError).identifier).toBe(SUI_OBJECT_ID);
	});

	test("a live blob the nodes did not return is a TransportError, not a not-found", async () => {
		const { client } = fakeClient({
			readBlob: async () => {
				throw new NoBlobMetadataReceivedError(
					"No valid blob metadata could be retrieved from any storage node.",
				);
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		const error = await readFailure(adapter.readBlobByObjectId(SUI_OBJECT_ID));
		expect(error).toBeInstanceOf(TransportError);
		const transport = error as TransportError;
		expect(transport.operation).toBe("walrus.readBlob");
		expect(transport.message).toBe(
			`Walrus storage nodes did not return blob ${READ_BLOB_ID}, which is certified and stored until epoch ${LIVE_END_EPOCH}: No valid blob metadata could be retrieved from any storage node.`,
		);
	});

	test("a live blob the nodes report missing is still a TransportError", async () => {
		const { client } = fakeClient({
			readBlob: async () => {
				throw new BlobNotCertifiedError("The blob does not exist.");
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		const error = await readFailure(adapter.readBlobByObjectId(SUI_OBJECT_ID));
		expect(error).toBeInstanceOf(TransportError);
		expect((error as TransportError).message).toContain(READ_BLOB_ID);
	});

	test("an ended lease is a BlobExpiredError keyed by the blob id", async () => {
		const { client } = fakeClient({
			getBlobObject: async () =>
				blobObject({ storage: { end_epoch: CURRENT_EPOCH } }),
			readBlob: async () => {
				throw new NoBlobMetadataReceivedError("no metadata");
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		const error = await readFailure(adapter.readBlobByObjectId(SUI_OBJECT_ID));
		expect(error).toBeInstanceOf(BlobExpiredError);
		const expired = error as BlobExpiredError;
		expect(expired.identifier).toBe(READ_BLOB_ID);
		expect(expired.blobObjectId).toBe(SUI_OBJECT_ID);
		expect(expired.endEpoch).toBe(CURRENT_EPOCH);
		expect(expired.currentEpoch).toBe(CURRENT_EPOCH);
	});

	test("a never-certified blob is a NotFoundError keyed by the blob id", async () => {
		const { client } = fakeClient({
			getBlobObject: async () => blobObject({ certified_epoch: null }),
			readBlob: async () => {
				throw new BlobNotCertifiedError("not certified");
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		const error = await readFailure(adapter.readBlobByObjectId(SUI_OBJECT_ID));
		expect(error).toBeInstanceOf(NotFoundError);
		expect(error).not.toBeInstanceOf(BlobExpiredError);
		expect((error as NotFoundError).identifier).toBe(READ_BLOB_ID);
	});

	test("an aborted read is passed through, not reclassified", async () => {
		const controller = new AbortController();
		const { client } = fakeClient({
			readBlob: async () => {
				controller.abort();
				throw new Error("Request was aborted.");
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		const error = await readFailure(
			adapter.readBlobByObjectId(SUI_OBJECT_ID, {
				signal: controller.signal,
			}),
		);
		expect(error).toBeInstanceOf(TransportError);
		expect((error as TransportError).message).toBe(
			`Walrus read of blob ${READ_BLOB_ID} failed: Request was aborted.`,
		);
	});

	test("an unreadable system state fails before the blob read", async () => {
		const { client, calls } = fakeClient({
			systemState: async () => {
				throw new Error("rpc down");
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		const error = await readFailure(adapter.readBlobByObjectId(SUI_OBJECT_ID));
		expect(error).toBeInstanceOf(TransportError);
		expect((error as TransportError).operation).toBe("walrus.systemState");
		expect(calls.readBlob).toHaveLength(0);
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

	test("maps a patch no node stores to NotFoundError keyed by the patch id", async () => {
		const { client } = fakeClient({
			getFiles: async () => {
				throw new BlobNotCertifiedError("not certified");
			},
		});
		const adapter = new DefaultWalrusReadAdapter({ client });
		const error = await readFailure(adapter.readQuiltPatch(PATCH_ID));
		expect(error).toBeInstanceOf(NotFoundError);
		expect((error as NotFoundError).identifier).toBe(
			quiltPatchIdToString(PATCH_ID),
		);
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
