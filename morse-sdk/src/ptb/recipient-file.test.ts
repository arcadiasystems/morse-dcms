import { describe, expect, test } from "bun:test";

import {
	Transaction,
	type TransactionArgument,
} from "@mysten/sui/transactions";

import {
	toBlobObjectId,
	toPackageId,
	toRecipientFileId,
	toSuiAddress,
	toWalrusBlobId,
} from "../codecs.js";
import {
	buildAddRecipient,
	buildDeleteRecipientFile,
	buildNewRecipientFile,
	buildNewRecipientFileWithSealPrefix,
	buildRemoveRecipient,
	buildShareRecipientFile,
	buildTransferRecipientFileOwnership,
	buildUpdateRecipientFileMetadata,
} from "./recipient-file.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const FILE_ID = toRecipientFileId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const BLOB_OBJECT_ID = toBlobObjectId(
	"0x000000000000000000000000000000000000000000000000000000000000bbbb",
);
const RECIPIENT = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000cccc",
);
// A real Walrus blob id is 43 URL-safe base64 chars; this is a valid shape.
const BLOB_ID = toWalrusBlobId("a".repeat(43));

function moveCall(tx: Transaction, index: number) {
	const command = tx.getData().commands[index];
	if (command?.$kind !== "MoveCall") {
		throw new Error(
			`expected MoveCall at index ${index}, got ${command?.$kind}`,
		);
	}
	return command.MoveCall;
}

describe("buildNewRecipientFile", () => {
	test("emits a moveCall to recipient_file::new_recipient_file", () => {
		const tx = new Transaction();
		buildNewRecipientFile(tx, {
			packageId: PACKAGE_ID,
			blobId: BLOB_ID,
			name: "tax.pdf",
			contentType: "application/pdf",
			size: 1234,
			recipients: [RECIPIENT],
		});
		// option::none for blob_object_id adds an extra moveCall; the
		// new_recipient_file call is the last one.
		const commands = tx.getData().commands;
		const newFileIndex = commands.length - 1;
		const call = moveCall(tx, newFileIndex);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("recipient_file");
		expect(call.function).toBe("new_recipient_file");
		expect(call.arguments).toHaveLength(7);
	});

	test("uses option::some when blob_object_id is supplied", () => {
		const tx = new Transaction();
		buildNewRecipientFile(tx, {
			packageId: PACKAGE_ID,
			blobId: BLOB_ID,
			blobObjectId: BLOB_OBJECT_ID,
			name: "n",
			contentType: "text/plain",
			size: 1,
			recipients: [],
		});
		const optionCall = moveCall(tx, 0);
		expect(optionCall.module).toBe("option");
		expect(optionCall.function).toBe("some");
	});
});

describe("buildNewRecipientFileWithSealPrefix", () => {
	test("targets recipient_file::new_recipient_file_with_seal_prefix and passes the prefix as the first arg", () => {
		const tx = new Transaction();
		buildNewRecipientFileWithSealPrefix(tx, {
			packageId: PACKAGE_ID,
			sealIdPrefix: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
			blobId: BLOB_ID,
			name: "n",
			contentType: "text/plain",
			size: 1,
			recipients: [],
		});
		const commands = tx.getData().commands;
		const newFileIndex = commands.length - 1;
		const call = moveCall(tx, newFileIndex);
		expect(call.function).toBe("new_recipient_file_with_seal_prefix");
		expect(call.arguments).toHaveLength(8);
	});
});

describe("buildShareRecipientFile", () => {
	test("emits a moveCall consuming the file argument", () => {
		const tx = new Transaction();
		const file = buildNewRecipientFile(tx, {
			packageId: PACKAGE_ID,
			blobId: BLOB_ID,
			name: "n",
			contentType: "text/plain",
			size: 1,
			recipients: [],
		});
		buildShareRecipientFile(tx, {
			packageId: PACKAGE_ID,
			file: file as TransactionArgument,
		});
		const commands = tx.getData().commands;
		const call = moveCall(tx, commands.length - 1);
		expect(call.function).toBe("share_recipient_file");
		expect(call.arguments).toHaveLength(1);
	});
});

describe("buildAddRecipient / buildRemoveRecipient", () => {
	test("buildAddRecipient targets add_recipient with file + address", () => {
		const tx = new Transaction();
		buildAddRecipient(tx, {
			packageId: PACKAGE_ID,
			file: FILE_ID,
			recipient: RECIPIENT,
		});
		const call = moveCall(tx, 0);
		expect(call.function).toBe("add_recipient");
		expect(call.arguments).toHaveLength(2);
	});

	test("buildRemoveRecipient targets remove_recipient", () => {
		const tx = new Transaction();
		buildRemoveRecipient(tx, {
			packageId: PACKAGE_ID,
			file: FILE_ID,
			recipient: RECIPIENT,
		});
		expect(moveCall(tx, 0).function).toBe("remove_recipient");
	});
});

describe("buildTransferRecipientFileOwnership", () => {
	test("targets transfer_ownership with file + new_owner", () => {
		const tx = new Transaction();
		buildTransferRecipientFileOwnership(tx, {
			packageId: PACKAGE_ID,
			file: FILE_ID,
			newOwner: RECIPIENT,
		});
		const call = moveCall(tx, 0);
		expect(call.function).toBe("transfer_ownership");
		expect(call.arguments).toHaveLength(2);
	});
});

describe("buildUpdateRecipientFileMetadata", () => {
	test("targets update_metadata with file + name + content_type", () => {
		const tx = new Transaction();
		buildUpdateRecipientFileMetadata(tx, {
			packageId: PACKAGE_ID,
			file: FILE_ID,
			name: "new.pdf",
			contentType: "application/pdf",
		});
		const call = moveCall(tx, 0);
		expect(call.function).toBe("update_metadata");
		expect(call.arguments).toHaveLength(3);
	});
});

describe("buildDeleteRecipientFile", () => {
	test("targets delete_file and consumes the file", () => {
		const tx = new Transaction();
		buildDeleteRecipientFile(tx, {
			packageId: PACKAGE_ID,
			file: FILE_ID,
		});
		const call = moveCall(tx, 0);
		expect(call.function).toBe("delete_file");
		expect(call.arguments).toHaveLength(1);
	});
});
