import { describe, expect, mock, test } from "bun:test";

import {
	toOwnerCapId,
	toPackageId,
	toPublicationId,
	toPublisherCapId,
	toSuiAddress,
	toSuiObjectId,
} from "../codecs.js";
import { TransportError } from "../errors.js";
import type { TxCreatedObject, TxReceipt } from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import {
	destroyPublisherCap,
	issuePublisherCap,
	revokePublisherCap,
} from "./cap.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const ORIGINAL_PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000222",
);
const PUBLICATION_ID = toPublicationId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const OWNER_CAP_ID = toOwnerCapId(
	"0x000000000000000000000000000000000000000000000000000000000000bbbb",
);
const PUBLISHER_CAP_ID = toPublisherCapId(
	"0x000000000000000000000000000000000000000000000000000000000000cccc",
);
const HOLDER = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000dddd",
);
const SENDER = toSuiAddress(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);

const CONFIG = {
	packageId: PACKAGE_ID,
	originalPackageId: ORIGINAL_PACKAGE_ID,
};

function created(objectId: string, name: string): TxCreatedObject {
	return {
		objectId: toSuiObjectId(objectId),
		objectType: `${ORIGINAL_PACKAGE_ID}::publication::${name}`,
	};
}

function makeAdapter(receipt: TxReceipt): WalletAdapter {
	return {
		address: SENDER,
		signAndExecuteTransaction: mock(async () => receipt),
		simulateTransaction: mock(async () => []),
	};
}

describe("issuePublisherCap", () => {
	test("returns the new PublisherCap id from the receipt", async () => {
		const adapter = makeAdapter({
			digest: "tx-issue",
			gasUsedMist: 500n,
			createdObjects: [created(PUBLISHER_CAP_ID, "PublisherCap")],
			deletedObjects: [],
		});
		const result = await issuePublisherCap(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			ownerCapId: OWNER_CAP_ID,
			holder: HOLDER,
		});
		expect(result.digest).toBe("tx-issue");
		expect(result.gasUsedMist).toBe(500n);
		expect(result.publisherCapId as string).toBe(PUBLISHER_CAP_ID as string);
	});

	test("throws TransportError when the receipt is missing the new cap", async () => {
		const adapter = makeAdapter({
			digest: "tx-issue",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			issuePublisherCap(adapter, CONFIG, {
				publicationId: PUBLICATION_ID,
				ownerCapId: OWNER_CAP_ID,
				holder: HOLDER,
			}),
		).rejects.toThrow(TransportError);
	});
});

describe("revokePublisherCap", () => {
	test("returns a typed receipt", async () => {
		const adapter = makeAdapter({
			digest: "tx-revoke",
			gasUsedMist: 200n,
			createdObjects: [],
			deletedObjects: [],
		});
		const result = await revokePublisherCap(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			ownerCapId: OWNER_CAP_ID,
			publisherCapId: PUBLISHER_CAP_ID,
		});
		expect(result.digest).toBe("tx-revoke");
		expect(result.gasUsedMist).toBe(200n);
	});
});

describe("destroyPublisherCap", () => {
	test("returns a typed receipt", async () => {
		const adapter = makeAdapter({
			digest: "tx-destroy",
			gasUsedMist: 100n,
			createdObjects: [],
			deletedObjects: [{ objectId: toSuiObjectId(PUBLISHER_CAP_ID) }],
		});
		const result = await destroyPublisherCap(adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			publisherCapId: PUBLISHER_CAP_ID,
		});
		expect(result.digest).toBe("tx-destroy");
		expect(result.gasUsedMist).toBe(100n);
	});
});
