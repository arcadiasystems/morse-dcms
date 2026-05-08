import { describe, expect, mock, test } from "bun:test";

import { bcs } from "@mysten/sui/bcs";

import {
	toBlobObjectId,
	toPackageId,
	toPublicationId,
	toPublisherCapId,
	toQuiltPatchId,
	toSuiAddress,
} from "../codecs.js";
import { ContractAbortError, TransportError } from "../errors.js";
import { buildPublisherSealId } from "../seal/identity.js";
import { QUILT_PATCH_ID_LENGTH, type TxReceipt } from "../types.js";
import type {
	SimulationReturnValues,
	WalletAdapter,
} from "../wallets/adapter.js";
import {
	addEncryptedEntry,
	addEntry,
	appendDraftRevision,
	appendEncryptedDraftRevision,
	deleteEntry,
	publishDirect,
	publishFromDraft,
} from "./entry.js";

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
const SENDER = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000dddd",
);
const PATCH_ID = toQuiltPatchId(new Uint8Array(QUILT_PATCH_ID_LENGTH).fill(1));

const CONFIG = { packageId: PACKAGE_ID };

const RECEIPT: TxReceipt = {
	digest: "tx-entry",
	gasUsedMist: 200n,
	createdObjects: [],
	deletedObjects: [],
};

function bcsU64(value: number): Uint8Array {
	return bcs.u64().serialize(value).toBytes();
}

function adapterReturning(u64: number): WalletAdapter {
	const sim: SimulationReturnValues = [[bcsU64(u64)]];
	return {
		address: SENDER,
		signAndExecuteTransaction: mock(async () => RECEIPT),
		simulateTransaction: mock(async () => sim),
	};
}

describe("addEntry", () => {
	test("returns entryId from simulation and revisionId 0", async () => {
		const adapter = adapterReturning(7);
		const result = await addEntry(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "blog",
			name: "first-post",
			blobObjectId: BLOB_OBJECT_ID,
			contentType: "text/markdown",
		});
		expect(result.entryId).toBe(7);
		expect(result.revisionId).toBe(0);
		expect(result.digest).toBe("tx-entry");
		expect(adapter.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(adapter.signAndExecuteTransaction).toHaveBeenCalledTimes(1);
	});

	test("forwards quiltPatchId for quilt-mode collections", async () => {
		const adapter = adapterReturning(0);
		const result = await addEntry(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "files",
			name: "image",
			blobObjectId: BLOB_OBJECT_ID,
			quiltPatchId: PATCH_ID,
			contentType: "image/png",
		});
		expect(result.entryId).toBe(0);
	});

	test("propagates ContractAbortError from simulation", async () => {
		const abort = ContractAbortError.fromAbortCode("entry", 0);
		const adapter: WalletAdapter = {
			address: SENDER,
			simulateTransaction: mock(async () => {
				throw abort;
			}),
			signAndExecuteTransaction: mock(async () => RECEIPT),
		};
		await expect(
			addEntry(adapter, CONFIG, {
				publicationId: PUBLICATION_ID,
				publisherCapId: PUBLISHER_CAP_ID,
				collectionName: "blog",
				name: "",
				blobObjectId: BLOB_OBJECT_ID,
				contentType: "text/markdown",
			}),
		).rejects.toBe(abort);
		expect(adapter.signAndExecuteTransaction).not.toHaveBeenCalled();
	});

	test("wraps absent return values as TransportError", async () => {
		const adapter: WalletAdapter = {
			address: SENDER,
			simulateTransaction: mock(async () => []),
			signAndExecuteTransaction: mock(async () => RECEIPT),
		};
		await expect(
			addEntry(adapter, CONFIG, {
				publicationId: PUBLICATION_ID,
				publisherCapId: PUBLISHER_CAP_ID,
				collectionName: "blog",
				name: "x",
				blobObjectId: BLOB_OBJECT_ID,
				contentType: "text/markdown",
			}),
		).rejects.toBeInstanceOf(TransportError);
	});

	test("aborts between simulate and execute when signal fires mid-flight", async () => {
		const controller = new AbortController();
		const adapter: WalletAdapter = {
			address: SENDER,
			simulateTransaction: mock(async () => {
				// Simulate the signal firing during the simulate→execute window.
				controller.abort();
				return [[bcsU64(7)]];
			}),
			signAndExecuteTransaction: mock(async (_tx, signal) => {
				// signAndExecute should observe the aborted signal and throw, never
				// produce a receipt.
				if (signal?.aborted) {
					throw new DOMException("aborted", "AbortError");
				}
				return RECEIPT;
			}),
		};
		await expect(
			addEntry(adapter, CONFIG, {
				publicationId: PUBLICATION_ID,
				publisherCapId: PUBLISHER_CAP_ID,
				collectionName: "blog",
				name: "x",
				blobObjectId: BLOB_OBJECT_ID,
				contentType: "text/markdown",
				signal: controller.signal,
			}),
		).rejects.toThrow();
		expect(adapter.signAndExecuteTransaction).toHaveBeenCalledTimes(1);
	});
});

describe("appendDraftRevision", () => {
	test("returns revisionId from simulation", async () => {
		const adapter = adapterReturning(3);
		const result = await appendDraftRevision(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "blog",
			entryId: 0,
			blobObjectId: BLOB_OBJECT_ID,
			contentType: "text/markdown",
		});
		expect(result.revisionId).toBe(3);
		expect(result.digest).toBe("tx-entry");
	});
});

describe("publishFromDraft", () => {
	test("returns revisionId from simulation", async () => {
		const adapter = adapterReturning(4);
		const result = await publishFromDraft(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "blog",
			entryId: 0,
			draftRevisionId: 3,
			blobObjectId: BLOB_OBJECT_ID,
			contentType: "text/markdown",
		});
		expect(result.revisionId).toBe(4);
	});
});

describe("publishDirect", () => {
	test("returns revisionId from simulation", async () => {
		const adapter = adapterReturning(2);
		const result = await publishDirect(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "blog",
			entryId: 0,
			blobObjectId: BLOB_OBJECT_ID,
			contentType: "text/markdown",
		});
		expect(result.revisionId).toBe(2);
	});
});

describe("deleteEntry", () => {
	test("returns the receipt without simulating", async () => {
		const adapter: WalletAdapter = {
			address: SENDER,
			signAndExecuteTransaction: mock(async () => RECEIPT),
			simulateTransaction: mock(async () => []),
		};
		const result = await deleteEntry(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "blog",
			entryId: 0,
		});
		expect(result.digest).toBe("tx-entry");
		expect(adapter.simulateTransaction).not.toHaveBeenCalled();
	});

	test("propagates ContractAbortError mapped to collection::EEntryNotFound", async () => {
		const abort = ContractAbortError.fromAbortCode("collection", 0);
		const adapter: WalletAdapter = {
			address: SENDER,
			signAndExecuteTransaction: mock(async () => {
				throw abort;
			}),
			simulateTransaction: mock(async () => []),
		};
		const promise = deleteEntry(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "blog",
			entryId: 99,
		});
		await expect(promise).rejects.toBe(abort);
		expect(abort.module).toBe("collection");
		expect(abort.reason).toBe("EEntryNotFound");
	});
});

describe("addEncryptedEntry", () => {
	test("returns entryId from simulation and revisionId 0", async () => {
		const sealId = buildPublisherSealId(
			PUBLICATION_ID,
			new Uint8Array([1, 2, 3]),
		);
		const adapter = adapterReturning(11);
		const result = await addEncryptedEntry(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "blog",
			name: "encrypted-post",
			blobObjectId: BLOB_OBJECT_ID,
			contentType: "application/octet-stream",
			sealId,
		});
		expect(result.entryId).toBe(11);
		expect(result.revisionId).toBe(0);
		expect(adapter.simulateTransaction).toHaveBeenCalledTimes(1);
		expect(adapter.signAndExecuteTransaction).toHaveBeenCalledTimes(1);
	});
});

describe("appendEncryptedDraftRevision", () => {
	test("returns revisionId from simulation", async () => {
		const sealId = buildPublisherSealId(
			PUBLICATION_ID,
			new Uint8Array([7, 7, 7, 7]),
		);
		const adapter = adapterReturning(5);
		const result = await appendEncryptedDraftRevision(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			collectionName: "blog",
			entryId: 0,
			blobObjectId: BLOB_OBJECT_ID,
			contentType: "application/octet-stream",
			sealId,
		});
		expect(result.revisionId).toBe(5);
	});
});
