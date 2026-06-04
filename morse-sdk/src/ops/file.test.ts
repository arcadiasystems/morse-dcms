import { describe, expect, mock, test } from "bun:test";

import {
	toAllowlistId,
	toBlobObjectId,
	toEncryptedFileId,
	toPackageId,
	toSuiAddress,
	toSuiObjectId,
	toWalrusBlobId,
} from "../codecs.js";
import { ValidationError } from "../errors.js";
import type { SuiAddress, TxCreatedObject, TxReceipt } from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import {
	createEncryptedFile,
	createPublicFile,
	deleteFile,
	transferFileOwnership,
	updateFileMetadata,
} from "./file.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const ORIGINAL_PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000222",
);
const ALLOWLIST_ID = toAllowlistId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const FILE_ID = toEncryptedFileId(
	"0x000000000000000000000000000000000000000000000000000000000000cafe",
);
const BLOB_ID = toWalrusBlobId("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
const BLOB_OBJECT_ID = toBlobObjectId(
	"0x000000000000000000000000000000000000000000000000000000000000b10b",
);
const SENDER = toSuiAddress(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const NEW_OWNER = toSuiAddress(
	"0x0000000000000000000000000000000000000000000000000000000000000222",
);

const CONFIG = {
	packageId: PACKAGE_ID,
	originalPackageId: ORIGINAL_PACKAGE_ID,
};

function fileCreated(): TxCreatedObject {
	// file module was introduced in the v2 upgrade — type identity uses
	// PACKAGE_ID, not ORIGINAL_PACKAGE_ID.
	return {
		objectId: toSuiObjectId(FILE_ID),
		objectType: `${PACKAGE_ID}::file::EncryptedFile`,
	};
}

function makeAdapter(
	receipt: TxReceipt,
	address: SuiAddress = SENDER,
): WalletAdapter {
	return {
		address,
		signAndExecuteTransaction: mock(async () => receipt),
		simulateTransaction: mock(async () => []),
	};
}

describe("createEncryptedFile", () => {
	test("returns fileId from receipt and validates fields", async () => {
		const adapter = makeAdapter({
			digest: "d-enc",
			gasUsedMist: 200n,
			createdObjects: [fileCreated()],
			deletedObjects: [],
		});
		const result = await createEncryptedFile(adapter, CONFIG, {
			allowlistId: ALLOWLIST_ID,
			blobId: BLOB_ID,
			blobObjectId: BLOB_OBJECT_ID,
			name: "secret.pdf",
			contentType: "application/pdf",
			size: 1234n,
		});
		expect(result.fileId).toBe(FILE_ID);
		expect(result.digest).toBe("d-enc");
	});

	test("rejects empty name", async () => {
		const adapter = makeAdapter({
			digest: "x",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			createEncryptedFile(adapter, CONFIG, {
				allowlistId: ALLOWLIST_ID,
				blobId: BLOB_ID,
				name: "",
				contentType: "application/pdf",
				size: 1n,
			}),
		).rejects.toBeInstanceOf(ValidationError);
	});

	test("rejects empty contentType", async () => {
		const adapter = makeAdapter({
			digest: "x",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			createEncryptedFile(adapter, CONFIG, {
				allowlistId: ALLOWLIST_ID,
				blobId: BLOB_ID,
				name: "x.txt",
				contentType: "",
				size: 1n,
			}),
		).rejects.toBeInstanceOf(ValidationError);
	});
});

describe("createPublicFile", () => {
	test("returns fileId from receipt", async () => {
		const adapter = makeAdapter({
			digest: "d-pub",
			gasUsedMist: 150n,
			createdObjects: [fileCreated()],
			deletedObjects: [],
		});
		const result = await createPublicFile(adapter, CONFIG, {
			blobId: BLOB_ID,
			name: "logo.png",
			contentType: "image/png",
			size: 2048n,
		});
		expect(result.fileId).toBe(FILE_ID);
	});
});

describe("updateFileMetadata / transferFileOwnership / deleteFile", () => {
	const baseReceipt: TxReceipt = {
		digest: "d",
		gasUsedMist: 10n,
		createdObjects: [],
		deletedObjects: [],
	};

	test("updateFileMetadata validates and returns the receipt", async () => {
		const adapter = makeAdapter(baseReceipt);
		const result = await updateFileMetadata(adapter, CONFIG, {
			fileId: FILE_ID,
			name: "new.md",
			contentType: "text/markdown",
		});
		expect(result.digest).toBe("d");
	});

	test("updateFileMetadata rejects empty name", async () => {
		const adapter = makeAdapter(baseReceipt);
		await expect(
			updateFileMetadata(adapter, CONFIG, {
				fileId: FILE_ID,
				name: "",
				contentType: "text/plain",
			}),
		).rejects.toBeInstanceOf(ValidationError);
	});

	test("transferFileOwnership returns the receipt", async () => {
		const adapter = makeAdapter(baseReceipt);
		const result = await transferFileOwnership(adapter, CONFIG, {
			fileId: FILE_ID,
			newOwner: NEW_OWNER,
		});
		expect(result.digest).toBe("d");
	});

	test("deleteFile returns the receipt", async () => {
		const adapter = makeAdapter(baseReceipt);
		const result = await deleteFile(adapter, CONFIG, { fileId: FILE_ID });
		expect(result.digest).toBe("d");
	});
});
