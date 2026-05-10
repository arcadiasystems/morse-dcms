import { describe, expect, mock, test } from "bun:test";
import { bcs } from "@mysten/sui/bcs";
import type { Signer } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";

import {
	toBlobObjectId,
	toPackageId,
	toPublicationId,
	toPublisherCapId,
	toSuiAddress,
	toWalrusBlobId,
} from "../codecs.js";
import { TransportError, UncertifiedBlobError } from "../errors.js";
import type { SealAdapter } from "../seal/adapter.js";
import { buildPublisherSealId } from "../seal/identity.js";
import type { TxReceipt } from "../types.js";
import type {
	SimulationReturnValues,
	WalletAdapter,
} from "../wallets/adapter.js";
import type {
	StartBlobUploadResult,
	WalrusFlowCapable,
	WalrusWriteAdapter,
} from "../walrus/index.js";
import { DefaultWalrusWriteAdapter } from "../walrus/index.js";
import {
	addEncryptedEntryFromBytes,
	addEntryFromBytes,
	type ProgressEvent,
} from "./entry-from-bytes.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const PUBLICATION_ID = toPublicationId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const PUBLISHER_CAP_ID = toPublisherCapId(
	"0x000000000000000000000000000000000000000000000000000000000000bbbb",
);
const BLOB_OBJECT_ID = toBlobObjectId(
	"0x000000000000000000000000000000000000000000000000000000000000cccc",
);
const BLOB_ID = toWalrusBlobId("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
const SENDER = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000dddd",
);

const CONFIG = { packageId: PACKAGE_ID };

const RECEIPT: TxReceipt = {
	digest: "tx-combined",
	gasUsedMist: 500n,
	createdObjects: [],
	deletedObjects: [],
};

function bcsU64(value: number): Uint8Array {
	return bcs.u64().serialize(value).toBytes();
}

/** Combined-PTB simulation: certify_blob (call 0) + add_entry (call 1). */
function combinedSim(entryId: number): SimulationReturnValues {
	return [[], [bcsU64(entryId)]];
}

function adapterReturning(entryId: number): WalletAdapter {
	return {
		address: SENDER,
		signAndExecuteTransaction: mock(async () => RECEIPT),
		simulateTransaction: mock(async () => combinedSim(entryId)),
	};
}

class FakeDefaultWalrus extends DefaultWalrusWriteAdapter {
	#stub:
		| { kind: "ok"; result: StartBlobUploadResult }
		| { kind: "err"; error: unknown };

	constructor(
		stub:
			| { kind: "ok"; result: StartBlobUploadResult }
			| { kind: "err"; error: unknown },
	) {
		super({
			client: {} as never,
			signer: {} as Signer,
		});
		this.#stub = stub;
	}

	override async startBlobUpload(): Promise<StartBlobUploadResult> {
		if (this.#stub.kind === "err") throw this.#stub.error;
		return this.#stub.result;
	}
}

function fakeUploadOk(): StartBlobUploadResult {
	return {
		blobObjectId: BLOB_OBJECT_ID,
		blobId: BLOB_ID,
		certifyTransaction: new Transaction(),
	};
}

describe("addEntryFromBytes", () => {
	test("returns entryId, revisionId=0, and surfaces blobObjectId+blobId", async () => {
		const adapter = adapterReturning(42);
		const walrus = new FakeDefaultWalrus({
			kind: "ok",
			result: fakeUploadOk(),
		});

		const result = await addEntryFromBytes(adapter, CONFIG, {
			walrus,
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "blog",
			name: "first-post",
			bytes: new Uint8Array([1, 2, 3]),
			contentType: "text/markdown",
			upload: { epochs: 3, deletable: true },
		});

		expect(result.entryId).toBe(42);
		expect(result.revisionId).toBe(0);
		expect(result.blobObjectId).toBe(BLOB_OBJECT_ID);
		expect(result.blobId).toBe(BLOB_ID);
		expect(result.digest).toBe("tx-combined");
		expect(adapter.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(adapter.signAndExecuteTransaction).toHaveBeenCalledTimes(1);
	});

	test("wraps a second-leg failure in UncertifiedBlobError carrying blobObjectId+blobId+cause", async () => {
		const cause = new Error("user rejected");
		const adapter: WalletAdapter = {
			address: SENDER,
			simulateTransaction: mock(async () => combinedSim(0)),
			signAndExecuteTransaction: mock(async () => {
				throw cause;
			}),
		};
		const walrus = new FakeDefaultWalrus({
			kind: "ok",
			result: fakeUploadOk(),
		});

		let caught: unknown;
		try {
			await addEntryFromBytes(adapter, CONFIG, {
				walrus,
				publicationId: PUBLICATION_ID,
				publisherCapId: PUBLISHER_CAP_ID,
				collectionName: "blog",
				name: "x",
				bytes: new Uint8Array([1]),
				contentType: "text/plain",
				upload: { epochs: 3, deletable: true },
			});
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(UncertifiedBlobError);
		const ub = caught as UncertifiedBlobError & { cause: unknown };
		expect(ub.blobObjectId).toBe(BLOB_OBJECT_ID);
		expect(ub.blobId).toBe(BLOB_ID);
		expect(ub.cause).toBe(cause);
	});

	test("rejects a non-flow-capable WalrusWriteAdapter with TransportError before any IO", async () => {
		const customWalrus: WalrusWriteAdapter = {
			uploadBlob: mock(async () => ({
				blobId: BLOB_ID,
				blobObjectId: BLOB_OBJECT_ID,
			})),
			uploadQuilt: mock(async () => {
				throw new Error("not used");
			}),
		};
		const adapter = adapterReturning(0);

		await expect(
			addEntryFromBytes(adapter, CONFIG, {
				walrus: customWalrus as unknown as WalrusWriteAdapter &
					WalrusFlowCapable,
				publicationId: PUBLICATION_ID,
				publisherCapId: PUBLISHER_CAP_ID,
				collectionName: "blog",
				name: "x",
				bytes: new Uint8Array([1]),
				contentType: "text/plain",
				upload: { epochs: 3, deletable: true },
			}),
		).rejects.toBeInstanceOf(TransportError);

		expect(customWalrus.uploadBlob).not.toHaveBeenCalled();
		expect(adapter.simulateTransaction).not.toHaveBeenCalled();
	});

	test("emits onProgress events in order: uploading, submitting, complete", async () => {
		const adapter = adapterReturning(1);
		const walrus = new FakeDefaultWalrus({
			kind: "ok",
			result: fakeUploadOk(),
		});
		const events: ProgressEvent[] = [];

		await addEntryFromBytes(adapter, CONFIG, {
			walrus,
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "blog",
			name: "x",
			bytes: new Uint8Array([1]),
			contentType: "text/plain",
			upload: { epochs: 3, deletable: true },
			onProgress: (e) => events.push(e),
		});

		expect(events.map((e) => e.phase)).toEqual([
			"uploading",
			"submitting",
			"complete",
		]);
	});

	test("propagates upload-step failure as the underlying TransportError, not UncertifiedBlobError", async () => {
		const original = new TransportError("walrus down");
		const adapter = adapterReturning(0);
		const walrus = new FakeDefaultWalrus({ kind: "err", error: original });

		await expect(
			addEntryFromBytes(adapter, CONFIG, {
				walrus,
				publicationId: PUBLICATION_ID,
				publisherCapId: PUBLISHER_CAP_ID,
				collectionName: "blog",
				name: "x",
				bytes: new Uint8Array([1]),
				contentType: "text/plain",
				upload: { epochs: 3, deletable: true },
			}),
		).rejects.toBe(original);
	});
});

describe("addEncryptedEntryFromBytes", () => {
	test("encrypts plaintext, uploads ciphertext, returns combined-PTB result", async () => {
		const adapter = adapterReturning(7);
		const walrus = new FakeDefaultWalrus({
			kind: "ok",
			result: fakeUploadOk(),
		});
		const ciphertext = new Uint8Array([0xfe, 0xed]);
		const seal: SealAdapter = {
			encrypt: mock(async () => ({ ciphertext })),
			decrypt: mock(async () => new Uint8Array()),
		};
		const sealId = buildPublisherSealId(
			PUBLICATION_ID,
			new Uint8Array(16).fill(0x55),
		);

		const result = await addEncryptedEntryFromBytes(adapter, CONFIG, {
			walrus,
			seal,
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "secret",
			name: "post",
			plaintext: new Uint8Array([1, 2, 3]),
			contentType: "application/octet-stream",
			sealId,
			upload: { epochs: 3, deletable: true },
		});

		expect(result.entryId).toBe(7);
		expect(result.revisionId).toBe(0);
		expect(result.blobObjectId).toBe(BLOB_OBJECT_ID);
		expect(seal.encrypt).toHaveBeenCalledTimes(1);
	});

	test("emits onProgress events in order: encrypting, uploading, submitting, complete", async () => {
		const adapter = adapterReturning(1);
		const walrus = new FakeDefaultWalrus({
			kind: "ok",
			result: fakeUploadOk(),
		});
		const ciphertext = new Uint8Array([0x55]);
		const seal: SealAdapter = {
			encrypt: mock(async () => ({ ciphertext })),
			decrypt: mock(async () => new Uint8Array()),
		};
		const sealId = buildPublisherSealId(
			PUBLICATION_ID,
			new Uint8Array(16).fill(0xab),
		);
		const events: ProgressEvent[] = [];

		await addEncryptedEntryFromBytes(adapter, CONFIG, {
			walrus,
			seal,
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "secret",
			name: "x",
			plaintext: new Uint8Array([1]),
			contentType: "application/octet-stream",
			sealId,
			upload: { epochs: 3, deletable: true },
			onProgress: (e) => events.push(e),
		});

		expect(events.map((e) => e.phase)).toEqual([
			"encrypting",
			"uploading",
			"submitting",
			"complete",
		]);
	});

	test("encryption failure is surfaced before any wallet popup", async () => {
		const sealError = new Error("encrypt failed");
		const adapter = adapterReturning(0);
		const walrus = new FakeDefaultWalrus({
			kind: "ok",
			result: fakeUploadOk(),
		});
		const seal: SealAdapter = {
			encrypt: mock(async () => {
				throw sealError;
			}),
			decrypt: mock(async () => new Uint8Array()),
		};
		const sealId = buildPublisherSealId(
			PUBLICATION_ID,
			new Uint8Array(16).fill(0x77),
		);

		await expect(
			addEncryptedEntryFromBytes(adapter, CONFIG, {
				walrus,
				seal,
				publicationId: PUBLICATION_ID,
				publisherCapId: PUBLISHER_CAP_ID,
				collectionName: "secret",
				name: "post",
				plaintext: new Uint8Array([1]),
				contentType: "application/octet-stream",
				sealId,
				upload: { epochs: 3, deletable: true },
			}),
		).rejects.toBe(sealError);

		expect(adapter.simulateTransaction).not.toHaveBeenCalled();
	});
});
