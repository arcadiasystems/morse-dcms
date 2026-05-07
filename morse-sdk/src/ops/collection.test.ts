import { describe, expect, mock, test } from "bun:test";

import {
	toPackageId,
	toPublicationId,
	toPublisherCapId,
	toSuiAddress,
} from "../codecs.js";
import { ContractAbortError } from "../errors.js";
import { StorageMode } from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import { createCollection, deleteCollection } from "./collection.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const ORIGINAL_PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000222",
);
const PUBLICATION_ID = toPublicationId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const PUBLISHER_CAP_ID = toPublisherCapId(
	"0x000000000000000000000000000000000000000000000000000000000000bbbb",
);
const SENDER = toSuiAddress(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);

const CONFIG = {
	packageId: PACKAGE_ID,
	originalPackageId: ORIGINAL_PACKAGE_ID,
};

function makeAdapter(): WalletAdapter {
	return {
		address: SENDER,
		signAndExecuteTransaction: mock(async () => ({
			digest: "tx-collection",
			gasUsedMist: 300n,
			createdObjects: [],
			deletedObjects: [],
		})),
	};
}

describe("createCollection", () => {
	test("returns a typed receipt for a blob-mode collection", async () => {
		const adapter = makeAdapter();
		const result = await createCollection(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			name: "blog",
			storageMode: StorageMode.Blob,
		});
		expect(result.digest).toBe("tx-collection");
		expect(result.gasUsedMist).toBe(300n);
	});

	test("returns a typed receipt for a quilt-mode collection", async () => {
		const adapter = makeAdapter();
		const result = await createCollection(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			name: "files",
			storageMode: StorageMode.Quilt,
		});
		expect(result.digest).toBe("tx-collection");
	});

	test("propagates ContractAbortError from the adapter", async () => {
		const adapter: WalletAdapter = {
			address: SENDER,
			signAndExecuteTransaction: mock(async () => {
				throw ContractAbortError.fromAbortCode("publication", 0);
			}),
		};
		await expect(
			createCollection(adapter, CONFIG, {
				publicationId: PUBLICATION_ID,
				publisherCapId: PUBLISHER_CAP_ID,
				name: "blog",
				storageMode: StorageMode.Blob,
			}),
		).rejects.toThrow(ContractAbortError);
	});
});

describe("deleteCollection", () => {
	test("returns a typed receipt", async () => {
		const adapter = makeAdapter();
		const result = await deleteCollection(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
			name: "blog",
		});
		expect(result.digest).toBe("tx-collection");
		expect(result.gasUsedMist).toBe(300n);
	});

	test("propagates ContractAbortError from the adapter", async () => {
		const adapter: WalletAdapter = {
			address: SENDER,
			signAndExecuteTransaction: mock(async () => {
				throw ContractAbortError.fromAbortCode("publication", 5);
			}),
		};
		await expect(
			deleteCollection(adapter, CONFIG, {
				publicationId: PUBLICATION_ID,
				publisherCapId: PUBLISHER_CAP_ID,
				name: "blog",
			}),
		).rejects.toThrow(ContractAbortError);
	});
});
