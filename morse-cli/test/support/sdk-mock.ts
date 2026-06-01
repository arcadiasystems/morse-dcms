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
};

mock.module("@arcadiasystems/morse-sdk", () => ({ ...real, ...ops }));

/** Clear recorded calls between tests. Call in beforeEach. */
export function resetSdkMock(): void {
	for (const spy of Object.values(ops)) {
		spy.mockClear();
	}
}
