import { describe, expect, mock, test } from "bun:test";

import {
	toPackageId,
	toRecipientFileId,
	toSuiAddress,
	toSuiObjectId,
	toWalrusBlobId,
} from "../codecs.js";
import { TransportError } from "../errors.js";
import type { TxCreatedObject, TxReceipt } from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import {
	addRecipient,
	createEncryptedRecipientFile,
	createRecipientFile,
	deleteRecipientFile,
	removeRecipient,
	transferRecipientFileOwnership,
	updateRecipientFileMetadata,
} from "./recipient-file.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const ORIGINAL_PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000222",
);
const FILE_ID = toRecipientFileId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const SENDER = toSuiAddress(
	"0x0000000000000000000000000000000000000000000000000000000000000999",
);
const RECIPIENT = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000cccc",
);
const BLOB_ID = toWalrusBlobId("a".repeat(43));

const CONFIG = {
	packageId: PACKAGE_ID,
	originalPackageId: ORIGINAL_PACKAGE_ID,
};

function created(objectId: string, typeName: string): TxCreatedObject {
	return {
		objectId: toSuiObjectId(objectId),
		objectType: `${PACKAGE_ID}::${typeName}`,
	};
}

function makeAdapter(receipt: TxReceipt): WalletAdapter {
	return {
		address: SENDER,
		signAndExecuteTransaction: mock(async () => receipt),
		simulateTransaction: mock(async () => []),
	};
}

describe("createRecipientFile", () => {
	test("parses the new RecipientFile id from the receipt", async () => {
		const adapter = makeAdapter({
			digest: "tx-create",
			gasUsedMist: 500n,
			createdObjects: [created(FILE_ID, "recipient_file::RecipientFile")],
			deletedObjects: [],
		});
		const result = await createRecipientFile(adapter, CONFIG, {
			blobId: BLOB_ID,
			name: "tax.pdf",
			contentType: "application/pdf",
			size: 1234,
			recipients: [RECIPIENT],
		});
		expect(result.digest).toBe("tx-create");
		expect(result.gasUsedMist).toBe(500n);
		expect(result.fileId as string).toBe(FILE_ID as string);
	});

	test("looks up the RecipientFile by type at packageId, not originalPackageId", async () => {
		// Sui's type identity uses the package id where the type was FIRST
		// defined. RecipientFile was introduced in v3, so the type-string root
		// is the current packageId. A receipt carrying the same id under the
		// originalPackageId would NOT match.
		const adapter = makeAdapter({
			digest: "tx-create",
			gasUsedMist: 500n,
			createdObjects: [
				{
					objectId: toSuiObjectId(FILE_ID),
					objectType: `${ORIGINAL_PACKAGE_ID}::recipient_file::RecipientFile`,
				},
			],
			deletedObjects: [],
		});
		await expect(
			createRecipientFile(adapter, CONFIG, {
				blobId: BLOB_ID,
				name: "x",
				contentType: "text/plain",
				size: 1,
				recipients: [],
			}),
		).rejects.toThrow(TransportError);
	});

	test("throws TransportError when the receipt has no RecipientFile", async () => {
		const adapter = makeAdapter({
			digest: "tx-create",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			createRecipientFile(adapter, CONFIG, {
				blobId: BLOB_ID,
				name: "n",
				contentType: "text/plain",
				size: 1,
				recipients: [],
			}),
		).rejects.toThrow(TransportError);
	});
});

describe("createEncryptedRecipientFile", () => {
	test("returns the new file id and forwards the seal prefix in the PTB", async () => {
		const adapter = makeAdapter({
			digest: "tx-enc",
			gasUsedMist: 600n,
			createdObjects: [created(FILE_ID, "recipient_file::RecipientFile")],
			deletedObjects: [],
		});
		const result = await createEncryptedRecipientFile(adapter, CONFIG, {
			sealIdPrefix: new Uint8Array([1, 2, 3]),
			blobId: BLOB_ID,
			name: "secret.pdf",
			contentType: "application/pdf",
			size: 100,
			recipients: [RECIPIENT],
		});
		expect(result.fileId as string).toBe(FILE_ID as string);
	});
});

describe("addRecipient / removeRecipient", () => {
	test("addRecipient returns the receipt", async () => {
		const adapter = makeAdapter({
			digest: "tx-add",
			gasUsedMist: 100n,
			createdObjects: [],
			deletedObjects: [],
		});
		const result = await addRecipient(adapter, CONFIG, {
			fileId: FILE_ID,
			recipient: RECIPIENT,
		});
		expect(result.digest).toBe("tx-add");
	});

	test("removeRecipient returns the receipt", async () => {
		const adapter = makeAdapter({
			digest: "tx-rm",
			gasUsedMist: 100n,
			createdObjects: [],
			deletedObjects: [],
		});
		const result = await removeRecipient(adapter, CONFIG, {
			fileId: FILE_ID,
			recipient: RECIPIENT,
		});
		expect(result.digest).toBe("tx-rm");
	});
});

describe("transferRecipientFileOwnership / updateRecipientFileMetadata / deleteRecipientFile", () => {
	test("each returns a typed receipt", async () => {
		const adapter = makeAdapter({
			digest: "tx",
			gasUsedMist: 50n,
			createdObjects: [],
			deletedObjects: [],
		});
		expect(
			(
				await transferRecipientFileOwnership(adapter, CONFIG, {
					fileId: FILE_ID,
					newOwner: RECIPIENT,
				})
			).digest,
		).toBe("tx");
		expect(
			(
				await updateRecipientFileMetadata(adapter, CONFIG, {
					fileId: FILE_ID,
					name: "new",
					contentType: "text/plain",
				})
			).digest,
		).toBe("tx");
		expect(
			(await deleteRecipientFile(adapter, CONFIG, { fileId: FILE_ID })).digest,
		).toBe("tx");
	});
});
