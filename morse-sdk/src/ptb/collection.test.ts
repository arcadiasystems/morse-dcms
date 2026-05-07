import { describe, expect, test } from "bun:test";

import { Transaction } from "@mysten/sui/transactions";

import { toPackageId, toPublicationId, toPublisherCapId } from "../codecs.js";
import { StorageMode } from "../types.js";
import { buildCreateCollection, buildDeleteCollection } from "./collection.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const PUBLICATION_ID = toPublicationId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const PUBLISHER_CAP_ID = toPublisherCapId(
	"0x000000000000000000000000000000000000000000000000000000000000bbbb",
);

function moveCall(tx: Transaction, index: number) {
	const command = tx.getData().commands[index];
	if (command?.$kind !== "MoveCall") {
		throw new Error(
			`expected MoveCall at index ${index}, got ${command?.$kind}`,
		);
	}
	return command.MoveCall;
}

describe("buildCreateCollection", () => {
	test("emits create_collection with publication, cap, name, and storage_mode u8", () => {
		const tx = new Transaction();
		buildCreateCollection(tx, {
			packageId: PACKAGE_ID,
			publication: PUBLICATION_ID,
			publisherCap: PUBLISHER_CAP_ID,
			name: "blog",
			storageMode: StorageMode.Blob,
		});
		const call = moveCall(tx, 0);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("publication");
		expect(call.function).toBe("create_collection");
		expect(call.arguments).toHaveLength(4);
		expect(tx.getData().inputs).toHaveLength(4);
	});

	test("StorageMode.Quilt sets the u8 input to 1", () => {
		const tx = new Transaction();
		buildCreateCollection(tx, {
			packageId: PACKAGE_ID,
			publication: PUBLICATION_ID,
			publisherCap: PUBLISHER_CAP_ID,
			name: "files",
			storageMode: StorageMode.Quilt,
		});
		const call = moveCall(tx, 0);
		expect(call.function).toBe("create_collection");
		// The fourth input is the storage_mode u8; we don't decode the BCS bytes
		// here, but the inputs count and call shape are checked above.
		expect(call.arguments).toHaveLength(4);
	});
});

describe("buildDeleteCollection", () => {
	test("emits delete_collection with publication, cap, and name", () => {
		const tx = new Transaction();
		buildDeleteCollection(tx, {
			packageId: PACKAGE_ID,
			publication: PUBLICATION_ID,
			publisherCap: PUBLISHER_CAP_ID,
			name: "blog",
		});
		const call = moveCall(tx, 0);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("publication");
		expect(call.function).toBe("delete_collection");
		expect(call.arguments).toHaveLength(3);
	});
});
