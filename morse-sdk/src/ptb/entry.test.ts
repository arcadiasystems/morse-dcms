import { describe, expect, test } from "bun:test";

import { Transaction } from "@mysten/sui/transactions";

import {
	toBlobObjectId,
	toPackageId,
	toPublicationId,
	toPublisherCapId,
	toQuiltPatchId,
} from "../codecs.js";
import { QUILT_PATCH_ID_LENGTH } from "../types.js";
import {
	buildAddEntry,
	buildAppendDraftRevision,
	buildDeleteEntry,
	buildPublishDirect,
	buildPublishFromDraft,
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
const PATCH_ID = toQuiltPatchId(new Uint8Array(QUILT_PATCH_ID_LENGTH).fill(7));

function moveCall(tx: Transaction, index: number) {
	const command = tx.getData().commands[index];
	if (command?.$kind !== "MoveCall") {
		throw new Error(
			`expected MoveCall at index ${index}, got ${command?.$kind}`,
		);
	}
	return command.MoveCall;
}

describe("buildAddEntry", () => {
	test("emits add_entry_to_collection with 10 args (blob mode)", () => {
		const tx = new Transaction();
		buildAddEntry(tx, {
			packageId: PACKAGE_ID,
			publication: PUBLICATION_ID,
			publisherCap: PUBLISHER_CAP_ID,
			collectionName: "blog",
			name: "first-post",
			blobObjectId: BLOB_OBJECT_ID,
			contentType: "text/markdown",
		});
		const call = moveCall(tx, 0);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("publication");
		expect(call.function).toBe("add_entry_to_collection");
		expect(call.arguments).toHaveLength(10);
	});

	test("includes a quilt_patch_id Some when supplied", () => {
		const tx = new Transaction();
		buildAddEntry(tx, {
			packageId: PACKAGE_ID,
			publication: PUBLICATION_ID,
			publisherCap: PUBLISHER_CAP_ID,
			collectionName: "files",
			name: "image",
			blobObjectId: BLOB_OBJECT_ID,
			quiltPatchId: PATCH_ID,
			contentType: "image/png",
		});
		const call = moveCall(tx, 0);
		expect(call.arguments).toHaveLength(10);
	});
});

describe("buildAppendDraftRevision", () => {
	test("emits append_collection_entry_draft_revision with 10 args", () => {
		const tx = new Transaction();
		buildAppendDraftRevision(tx, {
			packageId: PACKAGE_ID,
			publication: PUBLICATION_ID,
			publisherCap: PUBLISHER_CAP_ID,
			collectionName: "blog",
			entryId: 0,
			blobObjectId: BLOB_OBJECT_ID,
			contentType: "text/markdown",
		});
		const call = moveCall(tx, 0);
		expect(call.function).toBe("append_collection_entry_draft_revision");
		expect(call.arguments).toHaveLength(10);
	});
});

describe("buildPublishFromDraft", () => {
	test("emits publish_collection_entry_from_draft with 8 args", () => {
		const tx = new Transaction();
		buildPublishFromDraft(tx, {
			packageId: PACKAGE_ID,
			publication: PUBLICATION_ID,
			publisherCap: PUBLISHER_CAP_ID,
			collectionName: "blog",
			entryId: 0,
			draftRevisionId: 1,
			blobObjectId: BLOB_OBJECT_ID,
			contentType: "text/markdown",
		});
		const call = moveCall(tx, 0);
		expect(call.function).toBe("publish_collection_entry_from_draft");
		expect(call.arguments).toHaveLength(8);
	});
});

describe("buildPublishDirect", () => {
	test("emits publish_collection_entry_direct with 7 args", () => {
		const tx = new Transaction();
		buildPublishDirect(tx, {
			packageId: PACKAGE_ID,
			publication: PUBLICATION_ID,
			publisherCap: PUBLISHER_CAP_ID,
			collectionName: "blog",
			entryId: 0,
			blobObjectId: BLOB_OBJECT_ID,
			contentType: "text/markdown",
		});
		const call = moveCall(tx, 0);
		expect(call.function).toBe("publish_collection_entry_direct");
		expect(call.arguments).toHaveLength(7);
	});
});

describe("buildDeleteEntry", () => {
	test("emits delete_entry_from_collection with 4 args", () => {
		const tx = new Transaction();
		buildDeleteEntry(tx, {
			packageId: PACKAGE_ID,
			publication: PUBLICATION_ID,
			publisherCap: PUBLISHER_CAP_ID,
			collectionName: "blog",
			entryId: 5,
		});
		const call = moveCall(tx, 0);
		expect(call.function).toBe("delete_entry_from_collection");
		expect(call.arguments).toHaveLength(4);
	});
});
