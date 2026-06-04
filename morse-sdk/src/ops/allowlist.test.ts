import { describe, expect, mock, test } from "bun:test";

import {
	toAllowlistCapId,
	toAllowlistId,
	toPackageId,
	toSuiAddress,
	toSuiObjectId,
} from "../codecs.js";
import { ValidationError } from "../errors.js";
import type { SuiAddress, TxCreatedObject, TxReceipt } from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import {
	addMember,
	createAllowlist,
	deleteAllowlist,
	removeMember,
	transferAllowlistCap,
} from "./allowlist.js";

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const ORIGINAL_PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000222",
);
const ALLOWLIST_ID = toAllowlistId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const CAP_ID = toAllowlistCapId(
	"0x000000000000000000000000000000000000000000000000000000000000bbbb",
);
const SENDER = toSuiAddress(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const MEMBER = toSuiAddress(
	"0x0000000000000000000000000000000000000000000000000000000000000aaa",
);

const CONFIG = {
	packageId: PACKAGE_ID,
	originalPackageId: ORIGINAL_PACKAGE_ID,
};

function created(
	objectId: string,
	module: string,
	name: string,
): TxCreatedObject {
	// Allowlist + file modules were introduced in the v2 upgrade, so their
	// type identity uses PACKAGE_ID (the upgrade's published-at), not
	// ORIGINAL_PACKAGE_ID. Matches production findCreatedId behavior.
	return {
		objectId: toSuiObjectId(objectId),
		objectType: `${PACKAGE_ID}::${module}::${name}`,
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

describe("createAllowlist", () => {
	test("returns allowlistId + capId from the receipt", async () => {
		const receipt: TxReceipt = {
			digest: "digest-1",
			gasUsedMist: 100n,
			createdObjects: [
				created(ALLOWLIST_ID, "allowlist", "Allowlist"),
				created(CAP_ID, "allowlist", "Cap"),
			],
			deletedObjects: [],
		};
		const adapter = makeAdapter(receipt);
		const result = await createAllowlist(adapter, CONFIG, {
			name: "team-docs",
		});
		expect(result.allowlistId).toBe(ALLOWLIST_ID);
		expect(result.capId).toBe(CAP_ID);
		expect(result.digest).toBe("digest-1");
		expect(result.gasUsedMist).toBe(100n);
	});

	test("rejects empty name", async () => {
		const adapter = makeAdapter({
			digest: "x",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			createAllowlist(adapter, CONFIG, { name: "" }),
		).rejects.toBeInstanceOf(ValidationError);
	});

	test("rejects too-long name (>256)", async () => {
		const adapter = makeAdapter({
			digest: "x",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			createAllowlist(adapter, CONFIG, { name: "x".repeat(257) }),
		).rejects.toBeInstanceOf(ValidationError);
	});
});

describe("addMember / removeMember", () => {
	test("addMember forwards args and returns the receipt", async () => {
		const adapter = makeAdapter({
			digest: "d-add",
			gasUsedMist: 50n,
			createdObjects: [],
			deletedObjects: [],
		});
		const result = await addMember(adapter, CONFIG, {
			allowlistId: ALLOWLIST_ID,
			capId: CAP_ID,
			member: MEMBER,
		});
		expect(result.digest).toBe("d-add");
		expect(result.gasUsedMist).toBe(50n);
	});

	test("removeMember returns the receipt", async () => {
		const adapter = makeAdapter({
			digest: "d-rm",
			gasUsedMist: 25n,
			createdObjects: [],
			deletedObjects: [],
		});
		const result = await removeMember(adapter, CONFIG, {
			allowlistId: ALLOWLIST_ID,
			capId: CAP_ID,
			member: MEMBER,
		});
		expect(result.digest).toBe("d-rm");
	});
});

describe("transferAllowlistCap + deleteAllowlist", () => {
	test("transferAllowlistCap returns the receipt", async () => {
		const adapter = makeAdapter({
			digest: "d-xfer",
			gasUsedMist: 10n,
			createdObjects: [],
			deletedObjects: [],
		});
		const result = await transferAllowlistCap(adapter, CONFIG, {
			capId: CAP_ID,
			recipient: MEMBER,
		});
		expect(result.digest).toBe("d-xfer");
	});

	test("deleteAllowlist returns the receipt", async () => {
		const adapter = makeAdapter({
			digest: "d-del",
			gasUsedMist: 5n,
			createdObjects: [],
			deletedObjects: [],
		});
		const result = await deleteAllowlist(adapter, CONFIG, {
			allowlistId: ALLOWLIST_ID,
			capId: CAP_ID,
		});
		expect(result.digest).toBe("d-del");
	});
});
