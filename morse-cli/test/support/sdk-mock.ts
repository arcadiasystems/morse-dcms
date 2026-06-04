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

/** Canned RecipientFileSummary the reconcile mocks return by default. */
export const SUMMARY = {
	kind: "summary" as const,
	id: `0x${"9".repeat(64)}`,
	owner: `0x${"a".repeat(64)}`,
	name: "file.txt",
	contentType: "text/plain",
	size: 10,
	blobId: "blobSUM",
	members: [`0x${"a".repeat(64)}`],
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
	createRecipientFile: mock(
		canned({ fileId: `0x${"9".repeat(64)}`, digest: DIGEST, gasUsedMist: 0n }),
	),
	createEncryptedRecipientFile: mock(
		canned({ fileId: `0x${"9".repeat(64)}`, digest: DIGEST, gasUsedMist: 0n }),
	),
	addRecipient: mock(canned({ digest: DIGEST, gasUsedMist: 0n })),
	removeRecipient: mock(canned({ digest: DIGEST, gasUsedMist: 0n })),
	updateRecipientFileMetadata: mock(
		canned({ digest: DIGEST, gasUsedMist: 0n }),
	),
	transferRecipientFileOwnership: mock(
		canned({ digest: DIGEST, gasUsedMist: 0n }),
	),
	deleteRecipientFile: mock(canned({ digest: DIGEST, gasUsedMist: 0n })),
	uploadEncryptedRecipientFileFromBytes: mock(
		canned({
			fileId: `0x${"9".repeat(64)}`,
			blobId: "blobENC",
			blobObjectId: `0x${"a".repeat(64)}`,
			digest: DIGEST,
			gasUsedMist: 0n,
			sealIdPrefix: new Uint8Array([1, 2, 3, 4]),
			sealNonce: new Uint8Array([5, 6, 7, 8]),
		}),
	),
	uploadRecipientFileFromBytes: mock(
		canned({
			fileId: `0x${"9".repeat(64)}`,
			blobId: "blobPUB",
			blobObjectId: `0x${"a".repeat(64)}`,
			digest: DIGEST,
			gasUsedMist: 0n,
		}),
	),
	// Sync reconcile helpers; tests override per-case with mockReturnValueOnce.
	reconcileRecipientFilesOwnedBy: mock(() => [SUMMARY]),
	reconcileRecipientFilesAccessibleBy: mock(() => [SUMMARY]),
};

mock.module("@arcadiasystems/morse-sdk", () => ({ ...real, ...ops }));

/** Clear recorded calls between tests. Call in beforeEach. */
export function resetSdkMock(): void {
	for (const spy of Object.values(ops)) {
		spy.mockClear();
	}
}
