import { describe, expect, test } from "bun:test";

import { toPackageId, toSuiAddress } from "../codecs.js";
import {
	buildRecipientFileEventTypes,
	type RecipientFileEventInput,
	type RecipientFileEventTypes,
	reconcileRecipientFilesAccessibleBy,
	reconcileRecipientFilesOwnedBy,
} from "./recipient-file-events.js";

const ORIGIN = toPackageId("0xa");
const TYPES: RecipientFileEventTypes = buildRecipientFileEventTypes(ORIGIN);

const OWNER = toSuiAddress("0x1");
const ALICE = toSuiAddress("0x2");
const BOB = toSuiAddress("0x3");
const FILE_A =
	"0x000000000000000000000000000000000000000000000000000000000000000a";
const FILE_B =
	"0x000000000000000000000000000000000000000000000000000000000000000b";

function created(
	file: string,
	owner: string,
	members: readonly string[],
	tsMs = 1000,
	name = "f.pdf",
	contentType = "application/pdf",
	size = 100,
): RecipientFileEventInput {
	return {
		type: TYPES.RecipientFileCreated,
		json: { file, owner, name, content_type: contentType, size, members },
		timestampMs: tsMs,
	};
}

function deleted(file: string, tsMs = 2000): RecipientFileEventInput {
	return {
		type: TYPES.RecipientFileDeleted,
		json: { file, name: "f.pdf" },
		timestampMs: tsMs,
	};
}

function added(
	file: string,
	recipient: string,
	tsMs = 1500,
): RecipientFileEventInput {
	return {
		type: TYPES.RecipientAdded,
		json: { file, recipient },
		timestampMs: tsMs,
	};
}

function removed(
	file: string,
	recipient: string,
	tsMs = 1500,
): RecipientFileEventInput {
	return {
		type: TYPES.RecipientRemoved,
		json: { file, recipient },
		timestampMs: tsMs,
	};
}

function metadata(
	file: string,
	name: string,
	contentType: string,
	tsMs = 1500,
): RecipientFileEventInput {
	return {
		type: TYPES.RecipientFileMetadataUpdated,
		json: { file, name, content_type: contentType },
		timestampMs: tsMs,
	};
}

function ownership(
	file: string,
	previous: string,
	next: string,
	tsMs = 1500,
): RecipientFileEventInput {
	return {
		type: TYPES.RecipientFileOwnershipTransferred,
		json: { file, previous_owner: previous, new_owner: next },
		timestampMs: tsMs,
	};
}

describe("buildRecipientFileEventTypes", () => {
	test("composes fully qualified Move event types from origin package id", () => {
		const types = buildRecipientFileEventTypes(ORIGIN);
		expect(types.RecipientFileCreated).toBe(
			`${ORIGIN}::recipient_file::RecipientFileCreated`,
		);
		expect(types.RecipientRemoved).toBe(
			`${ORIGIN}::recipient_file::RecipientRemoved`,
		);
		expect(types.RecipientFileSealPrefixAttached).toBe(
			`${ORIGIN}::recipient_file::RecipientFileSealPrefixAttached`,
		);
	});
});

describe("reconcileRecipientFilesOwnedBy", () => {
	test("includes a created file owned by the queried address", () => {
		const events = [created(FILE_A, OWNER, [OWNER, ALICE])];
		const result = reconcileRecipientFilesOwnedBy(events, OWNER, TYPES);
		expect(result).toHaveLength(1);
		expect(result[0]?.id as string).toBe(FILE_A);
		expect(result[0]?.owner).toBe(OWNER);
		expect(result[0]?.members).toEqual([OWNER, ALICE]);
		expect(result[0]?.createdAtMs).toBe(1000);
	});

	test("excludes files owned by other addresses", () => {
		const events = [created(FILE_A, ALICE, [ALICE])];
		const result = reconcileRecipientFilesOwnedBy(events, OWNER, TYPES);
		expect(result).toEqual([]);
	});

	test("drops a file on RecipientFileDeleted", () => {
		const events = [created(FILE_A, OWNER, [OWNER]), deleted(FILE_A)];
		expect(reconcileRecipientFilesOwnedBy(events, OWNER, TYPES)).toEqual([]);
	});

	test("ownership transfer removes the file from the previous owner's list", () => {
		const events = [
			created(FILE_A, OWNER, [OWNER, ALICE]),
			ownership(FILE_A, OWNER, ALICE),
		];
		expect(reconcileRecipientFilesOwnedBy(events, OWNER, TYPES)).toEqual([]);
		const aliceFiles = reconcileRecipientFilesOwnedBy(events, ALICE, TYPES);
		expect(aliceFiles).toHaveLength(1);
		expect(aliceFiles[0]?.owner).toBe(ALICE);
	});

	test("metadata updates are applied", () => {
		const events = [
			created(FILE_A, OWNER, [OWNER]),
			metadata(FILE_A, "renamed.txt", "text/plain"),
		];
		const result = reconcileRecipientFilesOwnedBy(events, OWNER, TYPES);
		expect(result[0]?.name).toBe("renamed.txt");
		expect(result[0]?.contentType).toBe("text/plain");
	});

	test("unknown event types are ignored", () => {
		const events = [
			created(FILE_A, OWNER, [OWNER]),
			{
				type: "0xbeef::other_module::Unrelated",
				json: { file: FILE_A },
				timestampMs: 1500,
			},
		];
		expect(reconcileRecipientFilesOwnedBy(events, OWNER, TYPES)).toHaveLength(
			1,
		);
	});
});

describe("reconcileRecipientFilesAccessibleBy", () => {
	test("includes a file where the queried address is in members", () => {
		const events = [created(FILE_A, OWNER, [OWNER, ALICE])];
		const result = reconcileRecipientFilesAccessibleBy(events, ALICE, TYPES);
		expect(result).toHaveLength(1);
		expect(result[0]?.id as string).toBe(FILE_A);
	});

	test("RecipientAdded grows the accessible-by set", () => {
		const events = [created(FILE_A, OWNER, [OWNER]), added(FILE_A, BOB)];
		const result = reconcileRecipientFilesAccessibleBy(events, BOB, TYPES);
		expect(result).toHaveLength(1);
		expect(result[0]?.members).toContain(BOB);
	});

	test("RecipientRemoved shrinks the accessible-by set", () => {
		const events = [
			created(FILE_A, OWNER, [OWNER, ALICE]),
			removed(FILE_A, ALICE),
		];
		const result = reconcileRecipientFilesAccessibleBy(events, ALICE, TYPES);
		expect(result).toEqual([]);
	});

	test("multiple files reconcile independently", () => {
		const events = [
			created(FILE_A, OWNER, [OWNER, ALICE]),
			created(FILE_B, ALICE, [ALICE, BOB]),
			removed(FILE_A, ALICE),
		];
		const aliceAccessible = reconcileRecipientFilesAccessibleBy(
			events,
			ALICE,
			TYPES,
		);
		expect(aliceAccessible).toHaveLength(1);
		expect(aliceAccessible[0]?.id as string).toBe(FILE_B);
	});

	test("duplicate RecipientAdded for an existing member is a no-op", () => {
		const events = [
			created(FILE_A, OWNER, [OWNER, ALICE]),
			added(FILE_A, ALICE),
		];
		const result = reconcileRecipientFilesAccessibleBy(events, ALICE, TYPES);
		expect(result[0]?.members.filter((m) => m === ALICE)).toHaveLength(1);
	});
});
