/**
 * Intercepts the SDK write operations so handler cores can be exercised in
 * process with no network. Import this module before importing any command core
 * so the mock is registered first. The real module is spread through, so branded
 * codecs (toSuiAddress, toPublisherCapId, ...) and types stay genuine; only the
 * transaction-submitting ops are replaced with spies that record calls and
 * return canned results.
 */

import { mock } from "bun:test";

const real = await import("@arcadiasystems/morse-sdk");

const DIGEST = "0xtxdigest";

function canned<T>(value: T): (...args: unknown[]) => Promise<T> {
	return () => Promise.resolve(value);
}

/** Canned EncryptedFileSummary the reconcile mocks return by default. */
export const SUMMARY = {
	kind: "summary" as const,
	id: `0x${"9".repeat(64)}`,
	owner: `0x${"a".repeat(64)}`,
	name: "file.txt",
	contentType: "text/plain",
	size: 10,
	encrypted: true,
	allowlistId: `0x${"7".repeat(64)}`,
	createdAtMs: 1_700_000_000_000,
};

export const ops = {
	createPublication: mock(
		canned({
			publicationId: `0x${"b".repeat(64)}`,
			ownerCapId: `0x${"c".repeat(64)}`,
			publisherCapId: `0x${"d".repeat(64)}`,
			digest: DIGEST,
		}),
	),
	deletePublication: mock(canned({ digest: DIGEST })),
	transferOwnership: mock(canned({ digest: DIGEST })),
	createCollection: mock(canned({ digest: DIGEST })),
	deleteCollection: mock(canned({ digest: DIGEST })),
	addEntryFromBytes: mock(
		canned({ entryId: 0, blobId: "blob123", digest: DIGEST }),
	),
	deleteEntry: mock(canned({ digest: DIGEST })),
	addEncryptedEntryFromBytes: mock(canned({ entryId: 0, digest: DIGEST })),
	publishDirect: mock(canned({ revisionId: 1, digest: DIGEST })),
	appendDraftRevision: mock(canned({ revisionId: 1, digest: DIGEST })),
	publishFromDraft: mock(canned({ revisionId: 2, digest: DIGEST })),
	issuePublisherCap: mock(
		canned({ publisherCapId: `0x${"e".repeat(64)}`, digest: DIGEST }),
	),
	revokePublisherCap: mock(canned({ digest: DIGEST })),
	destroyPublisherCap: mock(canned({ digest: DIGEST })),
	transferPublisherCap: mock(canned({ digest: DIGEST })),
	createAllowlist: mock(
		canned({
			allowlistId: `0x${"7".repeat(64)}`,
			capId: `0x${"8".repeat(64)}`,
			digest: DIGEST,
			gasUsedMist: 0n,
		}),
	),
	addMember: mock(canned({ digest: DIGEST, gasUsedMist: 0n })),
	removeMember: mock(canned({ digest: DIGEST, gasUsedMist: 0n })),
	transferAllowlistCap: mock(canned({ digest: DIGEST, gasUsedMist: 0n })),
	deleteAllowlist: mock(canned({ digest: DIGEST, gasUsedMist: 0n })),
	createEncryptedFile: mock(
		canned({ fileId: `0x${"9".repeat(64)}`, digest: DIGEST, gasUsedMist: 0n }),
	),
	createPublicFile: mock(
		canned({ fileId: `0x${"9".repeat(64)}`, digest: DIGEST, gasUsedMist: 0n }),
	),
	updateFileMetadata: mock(canned({ digest: DIGEST, gasUsedMist: 0n })),
	transferFileOwnership: mock(canned({ digest: DIGEST, gasUsedMist: 0n })),
	deleteFile: mock(canned({ digest: DIGEST, gasUsedMist: 0n })),
	uploadEncryptedFileFromBytes: mock(
		canned({
			fileId: `0x${"9".repeat(64)}`,
			blobId: "blobENC",
			blobObjectId: `0x${"a".repeat(64)}`,
			digest: DIGEST,
			gasUsedMist: 0n,
		}),
	),
	uploadPublicFileFromBytes: mock(
		canned({
			fileId: `0x${"9".repeat(64)}`,
			blobId: "blobPUB",
			blobObjectId: `0x${"a".repeat(64)}`,
			digest: DIGEST,
			gasUsedMist: 0n,
		}),
	),
	// Sync reconcile helpers; tests override per-case with mockReturnValueOnce.
	reconcileFilesOwnedBy: mock(() => [SUMMARY]),
	reconcileFilesAccessibleBy: mock(() => [SUMMARY]),
};

mock.module("@arcadiasystems/morse-sdk", () => ({ ...real, ...ops }));

/** Clear recorded calls between tests. Call in beforeEach. */
export function resetSdkMock(): void {
	for (const spy of Object.values(ops)) {
		spy.mockClear();
	}
}
