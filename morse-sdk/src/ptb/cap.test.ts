import { describe, expect, test } from "bun:test";

import { Transaction } from "@mysten/sui/transactions";

import {
	toOwnerCapId,
	toPackageId,
	toPublicationId,
	toPublisherCapId,
	toSuiAddress,
} from "../codecs.js";
import {
	buildDestroyPublisherCap,
	buildIssuePublisherCap,
	buildRevokePublisherCap,
} from "./cap.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
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

function moveCall(tx: Transaction, index: number) {
	const command = tx.getData().commands[index];
	if (command?.$kind !== "MoveCall") {
		throw new Error(
			`expected MoveCall at index ${index}, got ${command?.$kind}`,
		);
	}
	return command.MoveCall;
}

describe("buildIssuePublisherCap", () => {
	test("emits issue_publisher_cap with publication, owner cap, and holder address", () => {
		const tx = new Transaction();
		buildIssuePublisherCap(tx, {
			packageId: PACKAGE_ID,
			publicationId: PUBLICATION_ID,
			ownerCap: OWNER_CAP_ID,
			holder: HOLDER,
		});
		const call = moveCall(tx, 0);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("publication");
		expect(call.function).toBe("issue_publisher_cap");
		expect(call.arguments).toHaveLength(3);
		expect(tx.getData().inputs).toHaveLength(3);
	});
});

describe("buildRevokePublisherCap", () => {
	test("emits revoke_publisher_cap with publication, owner cap, and cap id", () => {
		const tx = new Transaction();
		buildRevokePublisherCap(tx, {
			packageId: PACKAGE_ID,
			publicationId: PUBLICATION_ID,
			ownerCap: OWNER_CAP_ID,
			publisherCapId: PUBLISHER_CAP_ID,
		});
		const call = moveCall(tx, 0);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("publication");
		expect(call.function).toBe("revoke_publisher_cap");
		expect(call.arguments).toHaveLength(3);
	});
});

describe("buildDestroyPublisherCap", () => {
	test("emits destroy_publisher_cap with publication and cap object", () => {
		const tx = new Transaction();
		buildDestroyPublisherCap(tx, {
			packageId: PACKAGE_ID,
			publicationId: PUBLICATION_ID,
			publisherCap: PUBLISHER_CAP_ID,
		});
		const call = moveCall(tx, 0);
		expect(call.package).toBe(PACKAGE_ID as string);
		expect(call.module).toBe("publication");
		expect(call.function).toBe("destroy_publisher_cap");
		expect(call.arguments).toHaveLength(2);
	});
});
