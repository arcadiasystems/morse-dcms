import { describe, expect, test } from "bun:test";

import {
	Transaction,
	type TransactionArgument,
	type TransactionObjectArgument,
} from "@mysten/sui/transactions";

import {
	toOwnerCapId,
	toPackageId,
	toPublicationId,
	toRegistryId,
	toSuiAddress,
} from "../codecs.js";
import {
	buildCreatePublication,
	buildDeletePublication,
	buildSharePublication,
	buildTransferOwnerCap,
	buildTransferPublisherCap,
} from "./publication.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const REGISTRY_ID = toRegistryId(
	"0x0000000000000000000000000000000000000000000000000000000000000333",
);
const PUBLICATION_ID = toPublicationId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const OWNER_CAP_ID = toOwnerCapId(
	"0x000000000000000000000000000000000000000000000000000000000000bbbb",
);
const RECIPIENT = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000cccc",
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

describe("buildCreatePublication", () => {
	test("emits a single moveCall to publication::new_publication", () => {
		const tx = new Transaction();
		buildCreatePublication(tx, {
			packageId: PACKAGE_ID,
			registryId: REGISTRY_ID,
			name: "My Pub",
			slug: "my-pub",
		});
		const call = moveCall(tx, 0);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("publication");
		expect(call.function).toBe("new_publication");
		expect(call.arguments).toHaveLength(3);
		expect(call.typeArguments).toHaveLength(0);
	});

	test("registers exactly three inputs (registry object + name + slug)", () => {
		const tx = new Transaction();
		buildCreatePublication(tx, {
			packageId: PACKAGE_ID,
			registryId: REGISTRY_ID,
			name: "My Pub",
			slug: "my-pub",
		});
		expect(tx.getData().inputs).toHaveLength(3);
	});
});

describe("buildSharePublication", () => {
	test("emits a moveCall to publication::share_publication that consumes a result handle", () => {
		const tx = new Transaction();
		const created = buildCreatePublication(tx, {
			packageId: PACKAGE_ID,
			registryId: REGISTRY_ID,
			name: "My Pub",
			slug: "my-pub",
		});
		buildSharePublication(tx, {
			packageId: PACKAGE_ID,
			publication: created[0] as TransactionArgument,
		});
		expect(tx.getData().commands).toHaveLength(2);
		const call = moveCall(tx, 1);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("publication");
		expect(call.function).toBe("share_publication");
		expect(call.arguments).toHaveLength(1);
	});
});

describe("buildDeletePublication", () => {
	test("emits a moveCall to publication::delete_publication with three object inputs", () => {
		const tx = new Transaction();
		buildDeletePublication(tx, {
			packageId: PACKAGE_ID,
			registryId: REGISTRY_ID,
			publicationId: PUBLICATION_ID,
			ownerCapId: OWNER_CAP_ID,
		});
		const call = moveCall(tx, 0);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("publication");
		expect(call.function).toBe("delete_publication");
		expect(call.arguments).toHaveLength(3);
		expect(tx.getData().inputs).toHaveLength(3);
	});
});

describe("buildTransferOwnerCap", () => {
	test("accepts a cap object id and emits a transfer_owner_cap call", () => {
		const tx = new Transaction();
		buildTransferOwnerCap(tx, {
			packageId: PACKAGE_ID,
			ownerCap: OWNER_CAP_ID,
			recipient: RECIPIENT,
		});
		const call = moveCall(tx, 0);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("publication");
		expect(call.function).toBe("transfer_owner_cap");
		expect(call.arguments).toHaveLength(2);
		expect(tx.getData().inputs).toHaveLength(2);
	});

	test("accepts a TransactionArgument for chaining with prior PTB results", () => {
		const tx = new Transaction();
		const created = buildCreatePublication(tx, {
			packageId: PACKAGE_ID,
			registryId: REGISTRY_ID,
			name: "Pub",
			slug: "pub",
		});
		buildTransferOwnerCap(tx, {
			packageId: PACKAGE_ID,
			ownerCap: created[1] as TransactionObjectArgument,
			recipient: RECIPIENT,
		});
		expect(tx.getData().commands).toHaveLength(2);
		expect(moveCall(tx, 1).function).toBe("transfer_owner_cap");
	});
});

describe("buildTransferPublisherCap", () => {
	test("emits a moveCall to publication::transfer_publisher_cap with cap object + recipient address", () => {
		const tx = new Transaction();
		const created = buildCreatePublication(tx, {
			packageId: PACKAGE_ID,
			registryId: REGISTRY_ID,
			name: "Pub",
			slug: "pub",
		});
		buildTransferPublisherCap(tx, {
			packageId: PACKAGE_ID,
			publisherCap: created[2] as TransactionObjectArgument,
			recipient: RECIPIENT,
		});
		const call = moveCall(tx, 1);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("publication");
		expect(call.function).toBe("transfer_publisher_cap");
		expect(call.arguments).toHaveLength(2);
	});
});
