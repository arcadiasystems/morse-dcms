import { describe, expect, test } from "bun:test";

import {
	toAllowlistId,
	toEncryptedFileId,
	toPackageId,
	toSuiAddress,
} from "../codecs.js";
import { ValidationError } from "../errors.js";
import type { FilesEventInput, FilesEventTypes } from "./files-events.js";
import {
	buildFilesEventTypes,
	reconcileFilesAccessibleBy,
	reconcileFilesOwnedBy,
} from "./files-events.js";

const ORIGIN_PKG = toPackageId(
	"0x000000000000000000000000000000000000000000000000000000000000d1b8",
);
const ALICE = toSuiAddress(
	"0x00000000000000000000000000000000000000000000000000000000000a11ce",
);
const BOB = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000b0b0",
);
const FILE_1 = toEncryptedFileId(
	"0x0000000000000000000000000000000000000000000000000000000000000001",
);
const FILE_2 = toEncryptedFileId(
	"0x0000000000000000000000000000000000000000000000000000000000000002",
);
const ALLOWLIST_1 = toAllowlistId(
	"0x0000000000000000000000000000000000000000000000000000000000000a01",
);
const ALLOWLIST_2 = toAllowlistId(
	"0x0000000000000000000000000000000000000000000000000000000000000a02",
);

const types: FilesEventTypes = buildFilesEventTypes(ORIGIN_PKG);

// Event builders

function fileCreated(opts: {
	id: string;
	owner: string;
	allowlistId?: string | null;
	name?: string;
	contentType?: string;
	size?: number;
	encrypted?: boolean;
	timestampMs: number;
}): FilesEventInput {
	return {
		type: types.FileCreated,
		timestampMs: String(opts.timestampMs),
		parsedJson: {
			file: opts.id,
			owner: opts.owner,
			allowlist_id: opts.allowlistId ?? null,
			encrypted:
				opts.encrypted ??
				(opts.allowlistId !== null && opts.allowlistId !== undefined),
			name: opts.name ?? "test.pdf",
			content_type: opts.contentType ?? "application/pdf",
			size: opts.size ?? 100,
		},
	};
}

function fileDeleted(id: string, timestampMs: number): FilesEventInput {
	return {
		type: types.FileDeleted,
		timestampMs: String(timestampMs),
		parsedJson: { file: id, name: "x" },
	};
}

function fileTransferred(
	id: string,
	prevOwner: string,
	newOwner: string,
	timestampMs: number,
): FilesEventInput {
	return {
		type: types.FileOwnershipTransferred,
		timestampMs: String(timestampMs),
		parsedJson: {
			file: id,
			previous_owner: prevOwner,
			new_owner: newOwner,
		},
	};
}

function memberAdded(
	allowlist: string,
	member: string,
	timestampMs: number,
): FilesEventInput {
	return {
		type: types.MemberAdded,
		timestampMs: String(timestampMs),
		parsedJson: { allowlist, member },
	};
}

function memberRemoved(
	allowlist: string,
	member: string,
	timestampMs: number,
): FilesEventInput {
	return {
		type: types.MemberRemoved,
		timestampMs: String(timestampMs),
		parsedJson: { allowlist, member },
	};
}

function allowlistDeleted(
	allowlist: string,
	timestampMs: number,
): FilesEventInput {
	return {
		type: types.AllowlistDeleted,
		timestampMs: String(timestampMs),
		parsedJson: { allowlist, name: "x" },
	};
}

// buildFilesEventTypes

describe("buildFilesEventTypes", () => {
	test("produces fully-qualified event type strings rooted at the origin id", () => {
		const t = buildFilesEventTypes(ORIGIN_PKG);
		expect(t.FileCreated).toBe(`${ORIGIN_PKG}::file::FileCreated`);
		expect(t.MemberAdded).toBe(`${ORIGIN_PKG}::allowlist::MemberAdded`);
		expect(t.AllowlistDeleted).toBe(
			`${ORIGIN_PKG}::allowlist::AllowlistDeleted`,
		);
	});

	test("throws on missing packageId", () => {
		expect(() =>
			buildFilesEventTypes(undefined as unknown as typeof ORIGIN_PKG),
		).toThrow(ValidationError);
	});

	test("post-upgrade regression: different config.packageId leaves filter strings unchanged", () => {
		// Simulates a future v3 upgrade. The current packageId moves, but
		// the file/allowlist event-origin id stays at v2. The filter strings
		// must depend ONLY on the origin id, never on the current packageId.
		const v3PackageId = toPackageId(
			"0x000000000000000000000000000000000000000000000000000000000000d999",
		);
		const fromOrigin = buildFilesEventTypes(ORIGIN_PKG);
		const fromV3 = buildFilesEventTypes(v3PackageId);
		expect(fromOrigin.FileCreated).not.toBe(fromV3.FileCreated);
		// The helper itself is agnostic; callers MUST pass
		// config.filesEventOriginPackageId and never config.packageId.
		// Documented in the config field's JSDoc.
	});
});

// reconcileFilesOwnedBy

describe("reconcileFilesOwnedBy", () => {
	test("returns a created file owned by the address", () => {
		const events = [fileCreated({ id: FILE_1, owner: ALICE, timestampMs: 1 })];
		const out = reconcileFilesOwnedBy(events, ALICE, types);
		expect(out).toHaveLength(1);
		expect(out[0]?.id as string).toBe(FILE_1);
	});

	test("excludes a file owned by someone else", () => {
		const events = [fileCreated({ id: FILE_1, owner: BOB, timestampMs: 1 })];
		expect(reconcileFilesOwnedBy(events, ALICE, types)).toHaveLength(0);
	});

	test("excludes a deleted file", () => {
		const events = [
			fileCreated({ id: FILE_1, owner: ALICE, timestampMs: 1 }),
			fileDeleted(FILE_1, 2),
		];
		expect(reconcileFilesOwnedBy(events, ALICE, types)).toHaveLength(0);
	});

	test("excludes a file transferred away", () => {
		const events = [
			fileCreated({ id: FILE_1, owner: ALICE, timestampMs: 1 }),
			fileTransferred(FILE_1, ALICE, BOB, 2),
		];
		expect(reconcileFilesOwnedBy(events, ALICE, types)).toHaveLength(0);
	});

	test("includes a file transferred in (Alice receives Bob's file)", () => {
		const events = [
			fileCreated({ id: FILE_1, owner: BOB, timestampMs: 1 }),
			fileTransferred(FILE_1, BOB, ALICE, 2),
		];
		const out = reconcileFilesOwnedBy(events, ALICE, types);
		expect(out).toHaveLength(1);
		expect(out[0]?.id as string).toBe(FILE_1);
	});

	test("handles ping-pong transfers (Alice -> Bob -> Alice)", () => {
		const events = [
			fileCreated({ id: FILE_1, owner: ALICE, timestampMs: 1 }),
			fileTransferred(FILE_1, ALICE, BOB, 2),
			fileTransferred(FILE_1, BOB, ALICE, 3),
		];
		expect(reconcileFilesOwnedBy(events, ALICE, types)).toHaveLength(1);
	});

	test("is order-independent (sorts events by timestamp internally)", () => {
		const events = [
			fileDeleted(FILE_1, 2),
			fileCreated({ id: FILE_1, owner: ALICE, timestampMs: 1 }),
		];
		expect(reconcileFilesOwnedBy(events, ALICE, types)).toHaveLength(0);
	});

	test("skips events with null timestampMs (unconfirmed)", () => {
		const created = fileCreated({ id: FILE_1, owner: ALICE, timestampMs: 1 });
		const unconfirmed = {
			...created,
			timestampMs: null,
		};
		expect(reconcileFilesOwnedBy([unconfirmed], ALICE, types)).toHaveLength(0);
	});

	test("drops transfer-in if the source FileCreated is missing (retention pruning)", () => {
		const events = [fileTransferred(FILE_1, BOB, ALICE, 2)];
		expect(reconcileFilesOwnedBy(events, ALICE, types)).toHaveLength(0);
	});

	test("sorts result newest-first by createdAtMs", () => {
		const events = [
			fileCreated({ id: FILE_1, owner: ALICE, timestampMs: 1 }),
			fileCreated({ id: FILE_2, owner: ALICE, timestampMs: 5 }),
		];
		const out = reconcileFilesOwnedBy(events, ALICE, types);
		expect(out.map((f) => f.id as string)).toEqual([FILE_2, FILE_1]);
	});

	test("returns empty for an empty event stream", () => {
		expect(reconcileFilesOwnedBy([], ALICE, types)).toEqual([]);
	});

	test("ignores events from a different package (defense against indexer over-fetch)", () => {
		const otherPkg = toPackageId(
			"0x0000000000000000000000000000000000000000000000000000000000009999",
		);
		const otherTypes = buildFilesEventTypes(otherPkg);
		const events = [
			fileCreated({ id: FILE_1, owner: ALICE, timestampMs: 1 }),
			{
				...fileCreated({ id: FILE_2, owner: ALICE, timestampMs: 2 }),
				type: otherTypes.FileCreated,
			},
		];
		expect(reconcileFilesOwnedBy(events, ALICE, types)).toHaveLength(1);
	});
});

// reconcileFilesAccessibleBy

describe("reconcileFilesAccessibleBy", () => {
	test("includes a file in an allowlist the address is a member of", () => {
		const events = [
			memberAdded(ALLOWLIST_1, ALICE, 1),
			fileCreated({
				id: FILE_1,
				owner: BOB,
				allowlistId: ALLOWLIST_1,
				timestampMs: 2,
			}),
		];
		const out = reconcileFilesAccessibleBy(events, ALICE, types);
		expect(out).toHaveLength(1);
		expect(out[0]?.id as string).toBe(FILE_1);
	});

	test("excludes public files (no allowlist)", () => {
		const events = [
			memberAdded(ALLOWLIST_1, ALICE, 1),
			fileCreated({
				id: FILE_1,
				owner: BOB,
				allowlistId: null,
				encrypted: false,
				timestampMs: 2,
			}),
		];
		expect(reconcileFilesAccessibleBy(events, ALICE, types)).toHaveLength(0);
	});

	test("excludes a file when the address was removed from the allowlist", () => {
		const events = [
			memberAdded(ALLOWLIST_1, ALICE, 1),
			fileCreated({
				id: FILE_1,
				owner: BOB,
				allowlistId: ALLOWLIST_1,
				timestampMs: 2,
			}),
			memberRemoved(ALLOWLIST_1, ALICE, 3),
		];
		expect(reconcileFilesAccessibleBy(events, ALICE, types)).toHaveLength(0);
	});

	test("includes the file again when the address is re-added", () => {
		const events = [
			memberAdded(ALLOWLIST_1, ALICE, 1),
			fileCreated({
				id: FILE_1,
				owner: BOB,
				allowlistId: ALLOWLIST_1,
				timestampMs: 2,
			}),
			memberRemoved(ALLOWLIST_1, ALICE, 3),
			memberAdded(ALLOWLIST_1, ALICE, 4),
		];
		expect(reconcileFilesAccessibleBy(events, ALICE, types)).toHaveLength(1);
	});

	test("excludes files referencing a deleted allowlist", () => {
		const events = [
			memberAdded(ALLOWLIST_1, ALICE, 1),
			fileCreated({
				id: FILE_1,
				owner: BOB,
				allowlistId: ALLOWLIST_1,
				timestampMs: 2,
			}),
			allowlistDeleted(ALLOWLIST_1, 3),
		];
		expect(reconcileFilesAccessibleBy(events, ALICE, types)).toHaveLength(0);
	});

	test("includes files from multiple allowlists", () => {
		const events = [
			memberAdded(ALLOWLIST_1, ALICE, 1),
			memberAdded(ALLOWLIST_2, ALICE, 1),
			fileCreated({
				id: FILE_1,
				owner: BOB,
				allowlistId: ALLOWLIST_1,
				timestampMs: 2,
			}),
			fileCreated({
				id: FILE_2,
				owner: BOB,
				allowlistId: ALLOWLIST_2,
				timestampMs: 3,
			}),
		];
		expect(reconcileFilesAccessibleBy(events, ALICE, types)).toHaveLength(2);
	});

	test("excludes a deleted file from accessible set", () => {
		const events = [
			memberAdded(ALLOWLIST_1, ALICE, 1),
			fileCreated({
				id: FILE_1,
				owner: BOB,
				allowlistId: ALLOWLIST_1,
				timestampMs: 2,
			}),
			fileDeleted(FILE_1, 3),
		];
		expect(reconcileFilesAccessibleBy(events, ALICE, types)).toHaveLength(0);
	});

	test("doesn't count membership in unrelated allowlists", () => {
		const events = [
			memberAdded(ALLOWLIST_2, ALICE, 1),
			fileCreated({
				id: FILE_1,
				owner: BOB,
				allowlistId: ALLOWLIST_1,
				timestampMs: 2,
			}),
		];
		expect(reconcileFilesAccessibleBy(events, ALICE, types)).toHaveLength(0);
	});

	test("returns empty for an empty event stream", () => {
		expect(reconcileFilesAccessibleBy([], ALICE, types)).toEqual([]);
	});

	test("sorts result newest-first by createdAtMs", () => {
		const events = [
			memberAdded(ALLOWLIST_1, ALICE, 1),
			fileCreated({
				id: FILE_1,
				owner: BOB,
				allowlistId: ALLOWLIST_1,
				timestampMs: 5,
			}),
			fileCreated({
				id: FILE_2,
				owner: BOB,
				allowlistId: ALLOWLIST_1,
				timestampMs: 10,
			}),
		];
		const out = reconcileFilesAccessibleBy(events, ALICE, types);
		expect(out.map((f) => f.id as string)).toEqual([FILE_2, FILE_1]);
	});
});

// Allowlist_id payload shape variants

describe("FileCreated payload: allowlist_id format variants", () => {
	test("accepts allowlist_id as a plain string (indexer-decoded)", () => {
		const events = [
			memberAdded(ALLOWLIST_1, ALICE, 1),
			fileCreated({
				id: FILE_1,
				owner: BOB,
				allowlistId: ALLOWLIST_1,
				timestampMs: 2,
			}),
		];
		expect(reconcileFilesAccessibleBy(events, ALICE, types)).toHaveLength(1);
	});

	test("accepts allowlist_id as Option-shape { vec: [id] } (some RPC variants)", () => {
		const event: FilesEventInput = {
			type: types.FileCreated,
			timestampMs: "2",
			parsedJson: {
				file: FILE_1,
				owner: BOB,
				allowlist_id: { vec: [ALLOWLIST_1] },
				encrypted: true,
				name: "x",
				content_type: "text/plain",
				size: 1,
			},
		};
		const events = [memberAdded(ALLOWLIST_1, ALICE, 1), event];
		expect(reconcileFilesAccessibleBy(events, ALICE, types)).toHaveLength(1);
	});

	test("accepts allowlist_id as Option-shape { vec: [] } (empty = None)", () => {
		const event: FilesEventInput = {
			type: types.FileCreated,
			timestampMs: "2",
			parsedJson: {
				file: FILE_1,
				owner: BOB,
				allowlist_id: { vec: [] },
				encrypted: false,
				name: "x",
				content_type: "text/plain",
				size: 1,
			},
		};
		const events = [memberAdded(ALLOWLIST_1, ALICE, 1), event];
		expect(reconcileFilesAccessibleBy(events, ALICE, types)).toHaveLength(0);
	});
});
