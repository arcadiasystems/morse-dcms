/**
 * Reading: fetch publication / collection / entry / revision; iterate
 * entries paged or as an async stream.
 *
 * The reader pattern is interface-based: `PublicationReader` is the contract,
 * `RpcPublicationReader` is the gRPC-backed default. Future implementations
 * (e.g. an indexer-backed reader) satisfy the same shape, so consumer code
 * does not change.
 *
 * Construction note: always use `RpcPublicationReader.fromMorseConfig(config,
 * client)`, not the raw constructor. The constructor takes the canonical
 * `originalPackageId` as a positional argument; passing the post-upgrade
 * `packageId` instead silently empties type-filtered list results
 * (`listPublicationsOwnedBy`, `listPublisherCapsOwnedBy`).
 *
 * Function names in this file are illustrative.
 */

import type { Entry, Publication, PublicationId, Revision } from "morse-sdk";
import type { ExampleContext } from "./setup.js";

/**
 * Fetch a publication by ID. Returns the full struct including all
 * collections (inline), the revoked-publisher-caps table ID, and the
 * canonical name/slug.
 */
export async function fetchPublication(
	ctx: ExampleContext,
	publicationId: PublicationId,
): Promise<Publication> {
	return ctx.reader.getPublication(publicationId);
}

/**
 * Fetch one entry by collection name + entry ID. Returns the full revision
 * vector. `BlobRef` is a discriminated union: switch on `blobRef.kind`
 * (`"blob"` carries `blobObjectId`; `"quilt"` carries a 37-byte branded
 * `patchId`).
 */
export async function fetchEntry(
	ctx: ExampleContext,
	publicationId: PublicationId,
	collectionName: string,
	entryId: number,
): Promise<Entry> {
	return ctx.reader.getEntry(publicationId, collectionName, entryId);
}

/**
 * Loads the whole entry and returns one revision. Use only when you would
 * have fetched the entry anyway; otherwise call `getEntry` once and index
 * into `revisions` yourself to avoid N+1 RPC patterns in loops.
 */
export async function fetchRevision(
	ctx: ExampleContext,
	publicationId: PublicationId,
	collectionName: string,
	entryId: number,
	revisionId: number,
): Promise<Revision> {
	return ctx.reader.getRevision(
		publicationId,
		collectionName,
		entryId,
		revisionId,
	);
}

/**
 * One page of entries with cursor for the next page. Order is dynamic-field
 * object-store order, NOT chronological. Sort by `entry.id` if you need
 * insertion order.
 *
 * `nextCursor === null` signals the end of the page sequence.
 */
export async function fetchFirstPage(
	ctx: ExampleContext,
	publicationId: PublicationId,
	collectionName: string,
): Promise<{ entries: readonly Entry[]; nextCursor: string | null }> {
	const page = await ctx.reader.listEntries(publicationId, collectionName);
	return { entries: page.results, nextCursor: page.nextCursor };
}

/**
 * Iterate every entry. `scanEntries` returns an `AsyncIterable<Entry>`,
 * which means consumers can `for await ... of` it and `break` early without
 * triggering further RPCs. Useful for "find first match" or bounded scans.
 *
 * Memory: only one page is held at a time, so this works for collections of
 * any size.
 */
export async function findEntryByName(
	ctx: ExampleContext,
	publicationId: PublicationId,
	collectionName: string,
	target: string,
): Promise<Entry | null> {
	for await (const entry of ctx.reader.scanEntries(
		publicationId,
		collectionName,
	)) {
		if (entry.name === target) {
			// Returning (or `break`) from inside the loop stops the async
			// iterator without issuing further RPC pages.
			return entry;
		}
	}
	return null;
}
