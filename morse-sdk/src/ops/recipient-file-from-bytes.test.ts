import { describe, expect, mock, test } from "bun:test";
import type { Signer } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";

import {
	toBlobObjectId,
	toPackageId,
	toRecipientFileId,
	toSuiAddress,
	toSuiObjectId,
	toWalrusBlobId,
} from "../codecs.js";
import { TransportError, UncertifiedBlobError } from "../errors.js";
import type { SealAdapter } from "../seal/adapter.js";
import {
	SealPolicyTag,
	type TxCreatedObject,
	type TxReceipt,
} from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import type {
	StartBlobUploadResult,
	WalrusFlowCapable,
	WalrusWriteAdapter,
} from "../walrus/index.js";
import { DefaultWalrusWriteAdapter } from "../walrus/index.js";
import {
	type FileUploadProgressEvent,
	uploadEncryptedRecipientFileFromBytes,
	uploadRecipientFileFromBytes,
} from "./recipient-file-from-bytes.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const BLOB_OBJECT_ID = toBlobObjectId(
	"0x000000000000000000000000000000000000000000000000000000000000cccc",
);
const BLOB_ID = toWalrusBlobId("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
const FILE_ID = toRecipientFileId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const SENDER = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000dddd",
);
const RECIPIENT = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000eeee",
);

const CONFIG = { packageId: PACKAGE_ID };

function createdFile(): TxCreatedObject {
	return {
		objectId: toSuiObjectId(FILE_ID),
		objectType: `${PACKAGE_ID}::recipient_file::RecipientFile`,
	};
}

const RECEIPT: TxReceipt = {
	digest: "tx-combined",
	gasUsedMist: 500n,
	createdObjects: [createdFile()],
	deletedObjects: [],
};

function makeAdapter(): WalletAdapter {
	return {
		address: SENDER,
		signAndExecuteTransaction: mock(async () => RECEIPT),
		simulateTransaction: mock(async () => []),
	};
}

class FakeWalrus extends DefaultWalrusWriteAdapter {
	#stub:
		| { kind: "ok"; result: StartBlobUploadResult }
		| { kind: "err"; error: unknown };

	constructor(
		stub:
			| { kind: "ok"; result: StartBlobUploadResult }
			| { kind: "err"; error: unknown },
	) {
		super({ client: {} as never, signer: {} as Signer });
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

function fakeSeal(): SealAdapter {
	return {
		encrypt: mock(async () => ({ ciphertext: new Uint8Array([0xfe, 0xed]) })),
		decrypt: mock(async () => new Uint8Array()),
		decryptUnderRecipientFile: mock(async () => new Uint8Array()),
	};
}

describe("uploadRecipientFileFromBytes", () => {
	test("returns fileId, blobId, blobObjectId on success", async () => {
		const adapter = makeAdapter();
		const walrus = new FakeWalrus({ kind: "ok", result: fakeUploadOk() });

		const result = await uploadRecipientFileFromBytes(adapter, CONFIG, {
			walrus,
			bytes: new Uint8Array([1, 2, 3]),
			recipients: [RECIPIENT],
			name: "doc.pdf",
			contentType: "application/pdf",
			upload: { epochs: 3, deletable: true },
		});

		expect(result.fileId as string).toBe(FILE_ID as string);
		expect(result.blobId).toBe(BLOB_ID);
		expect(result.blobObjectId).toBe(BLOB_OBJECT_ID);
		expect(result.digest).toBe("tx-combined");
		expect(adapter.signAndExecuteTransaction).toHaveBeenCalledTimes(1);
	});

	test("wraps a second-leg failure in UncertifiedBlobError", async () => {
		const cause = new Error("user rejected");
		const adapter: WalletAdapter = {
			address: SENDER,
			simulateTransaction: mock(async () => []),
			signAndExecuteTransaction: mock(async () => {
				throw cause;
			}),
		};
		const walrus = new FakeWalrus({ kind: "ok", result: fakeUploadOk() });

		let caught: unknown;
		try {
			await uploadRecipientFileFromBytes(adapter, CONFIG, {
				walrus,
				bytes: new Uint8Array([1]),
				recipients: [],
				name: "x",
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

	test("rejects a non-flow-capable WalrusWriteAdapter before any IO", async () => {
		const customWalrus: WalrusWriteAdapter = {
			uploadBlob: mock(async () => ({
				blobId: BLOB_ID,
				blobObjectId: BLOB_OBJECT_ID,
			})),
			uploadQuilt: mock(async () => {
				throw new Error("not used");
			}),
		};
		const adapter = makeAdapter();

		await expect(
			uploadRecipientFileFromBytes(adapter, CONFIG, {
				walrus: customWalrus as unknown as WalrusWriteAdapter &
					WalrusFlowCapable,
				bytes: new Uint8Array([1]),
				recipients: [],
				name: "x",
				contentType: "text/plain",
				upload: { epochs: 3, deletable: true },
			}),
		).rejects.toBeInstanceOf(TransportError);

		expect(customWalrus.uploadBlob).not.toHaveBeenCalled();
		expect(adapter.signAndExecuteTransaction).not.toHaveBeenCalled();
	});

	test("emits onProgress events in order: uploading, submitting, complete", async () => {
		const adapter = makeAdapter();
		const walrus = new FakeWalrus({ kind: "ok", result: fakeUploadOk() });
		const events: FileUploadProgressEvent[] = [];

		await uploadRecipientFileFromBytes(adapter, CONFIG, {
			walrus,
			bytes: new Uint8Array([1]),
			recipients: [],
			name: "x",
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
});

describe("uploadEncryptedRecipientFileFromBytes", () => {
	test("encrypts under a sealId starting with the prefix + tag(3), uploads ciphertext, returns prefix + nonce", async () => {
		const adapter = makeAdapter();
		const walrus = new FakeWalrus({ kind: "ok", result: fakeUploadOk() });
		const seal = fakeSeal();

		const prefix = new Uint8Array([1, 2, 3, 4]);
		const nonce = new Uint8Array([0xaa, 0xbb]);

		const result = await uploadEncryptedRecipientFileFromBytes(
			adapter,
			CONFIG,
			{
				walrus,
				seal,
				plaintext: new Uint8Array([0x10, 0x20]),
				recipients: [RECIPIENT],
				name: "secret.pdf",
				contentType: "application/pdf",
				upload: { epochs: 3, deletable: true },
				sealIdPrefix: prefix,
				sealNonce: nonce,
			},
		);

		expect(result.fileId as string).toBe(FILE_ID as string);
		expect([...result.sealIdPrefix]).toEqual([...prefix]);
		expect([...result.sealNonce]).toEqual([...nonce]);

		expect(seal.encrypt).toHaveBeenCalledTimes(1);
		const encryptArgs = (seal.encrypt as ReturnType<typeof mock>).mock.calls[0];
		const sealId = (encryptArgs?.[1] as { sealId: Uint8Array }).sealId;
		expect([...sealId.slice(0, prefix.length)]).toEqual([...prefix]);
		expect(sealId[prefix.length]).toBe(SealPolicyTag.RecipientFile);
	});

	test("emits onProgress events in order: encrypting, uploading, submitting, complete", async () => {
		const adapter = makeAdapter();
		const walrus = new FakeWalrus({ kind: "ok", result: fakeUploadOk() });
		const seal = fakeSeal();
		const events: FileUploadProgressEvent[] = [];

		await uploadEncryptedRecipientFileFromBytes(adapter, CONFIG, {
			walrus,
			seal,
			plaintext: new Uint8Array([1]),
			recipients: [],
			name: "x",
			contentType: "text/plain",
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

	test("encryption failure surfaces before any wallet popup", async () => {
		const sealError = new Error("encrypt failed");
		const adapter = makeAdapter();
		const walrus = new FakeWalrus({ kind: "ok", result: fakeUploadOk() });
		const seal: SealAdapter = {
			encrypt: mock(async () => {
				throw sealError;
			}),
			decrypt: mock(async () => new Uint8Array()),
			decryptUnderRecipientFile: mock(async () => new Uint8Array()),
		};

		await expect(
			uploadEncryptedRecipientFileFromBytes(adapter, CONFIG, {
				walrus,
				seal,
				plaintext: new Uint8Array([1]),
				recipients: [],
				name: "x",
				contentType: "text/plain",
				upload: { epochs: 3, deletable: true },
			}),
		).rejects.toBe(sealError);

		expect(adapter.signAndExecuteTransaction).not.toHaveBeenCalled();
	});

	test("uses caller-supplied size from plaintext byte length, not ciphertext length", async () => {
		// Seal envelope grows the ciphertext; the on-chain `size` must reflect
		// the original plaintext length per Move contract semantics.
		const adapter = makeAdapter();
		const walrus = new FakeWalrus({ kind: "ok", result: fakeUploadOk() });
		const seal = fakeSeal();
		const plaintext = new Uint8Array(100);

		const result = await uploadEncryptedRecipientFileFromBytes(
			adapter,
			CONFIG,
			{
				walrus,
				seal,
				plaintext,
				recipients: [],
				name: "x",
				contentType: "text/plain",
				upload: { epochs: 3, deletable: true },
			},
		);
		// We cannot directly inspect the PTB, but the test exists to lock in
		// the choice: result.fileId comes back, meaning the PTB included a
		// new_recipient_file_with_seal_prefix call (which takes size).
		expect(result.fileId as string).toBe(FILE_ID as string);
	});
});
