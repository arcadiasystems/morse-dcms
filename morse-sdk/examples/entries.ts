/**
 * Entry and revision lifecycle, blob mode.
 *
 * Mental model:
 * - An entry has a stable monotonic `entryId` (assigned at insertion;
 *   unchanged across the entry's life).
 * - Revisions are append-only. Each carries its own `BlobRef`, content type,
 *   encryption flag, access policy.
 * - Two heads point into the revision vector: `draftHead` (work in progress;
 *   may be encrypted) and `publicHead` (always non-encrypted, public).
 * - You can never edit a revision in place. Mutations append a new one.
 * - Deletion removes the whole entry, not individual revisions.
 *
 * The four mutation functions:
 * - `addEntry`: create a new entry whose first revision is the first public
 *   revision. Returns `entryId`. `revisionId` is always 0.
 * - `appendDraftRevision`: append a draft. Updates `draftHead`. The publish
 *   head is unchanged.
 * - `publishFromDraft`: append a new *public* revision. Validates that
 *   `draftRevisionId` exists. The new revision takes a fresh blob; the
 *   draft's blob is not reused (passing the same `blobObjectId` is allowed
 *   but not required).
 * - `publishDirect`: append a public revision in one step (skip draft).
 *
 * No encrypted publish path: `publishFromDraft` and `publishDirect` create
 * non-encrypted public revisions only. Encrypted content lives as drafts.
 *
 * The four functions that return a `u64` (entryId / revisionId) cost two
 * RPCs each: one simulate, one execute. The simulate read is how the SDK
 * surfaces the return value; you can't get it from a normal Sui receipt.
 *
 * Note: `collectionName: "blog"` is hardcoded throughout for readability;
 * collection names are arbitrary, picked at `createCollection` time. Function
 * names in this file are illustrative.
 */

import type {
	BlobObjectId,
	PublicationId,
	PublisherCapId,
} from "@arcadiasystems/morse-sdk";
import {
	addEntry,
	addEntryFromBytes,
	appendDraftRevision,
	DefaultWalrusWriteAdapter,
	deleteEntry,
	publishDirect,
	publishFromDraft,
} from "@arcadiasystems/morse-sdk";
import type { ExampleContext } from "./setup.js";

/**
 * Create an entry by uploading `bytes` to Walrus and adding the resulting
 * blob in 2 wallet popups (register, then certify+addEntry combined).
 * Recommended path for the typical "publish content" flow.
 */
export async function createPost(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		bytes: Uint8Array;
	},
): Promise<number> {
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);
	const result = await addEntryFromBytes(ctx.adapter, ctx.config, {
		walrus,
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		collectionName: "blog",
		name: "first-post",
		bytes: args.bytes,
		contentType: "text/plain",
		upload: { epochs: 3, deletable: true },
	});
	return result.entryId;
}

/**
 * Lower-level alternative when you already have an uploaded blob (e.g. for
 * blob deduplication across entries, server-side pre-upload, or decoupled
 * upload-then-publish UX). Uses 1 wallet popup, but requires a separate
 * `uploadBlob` call elsewhere (2 popups for the upload, 1 for this op = 3
 * total). Prefer `createPost` above unless you need this control.
 */
export async function createPostFromExistingBlob(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		blobObjectId: BlobObjectId;
	},
): Promise<number> {
	const result = await addEntry(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		collectionName: "blog",
		name: "first-post",
		blobObjectId: args.blobObjectId,
		contentType: "text/plain",
	});
	return result.entryId;
}

/**
 * Stage a new draft on an existing entry without affecting `publicHead`.
 * Useful for "work in progress" content the publisher is iterating on
 * before exposing it.
 */
export async function stageDraft(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		entryId: number;
		newBlobObjectId: BlobObjectId;
	},
): Promise<number> {
	const result = await appendDraftRevision(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		collectionName: "blog",
		entryId: args.entryId,
		blobObjectId: args.newBlobObjectId,
		contentType: "text/plain",
	});
	return result.revisionId;
}

/**
 * Promote a draft. Despite the name, this APPENDS a fresh public revision;
 * the draft is referenced only for validation. You can pass a different
 * `blobObjectId` than the draft used.
 */
export async function publishDraft(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		entryId: number;
		draftRevisionId: number;
		blobObjectId: BlobObjectId;
	},
): Promise<number> {
	const result = await publishFromDraft(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		collectionName: "blog",
		entryId: args.entryId,
		draftRevisionId: args.draftRevisionId,
		blobObjectId: args.blobObjectId,
		contentType: "text/plain",
	});
	return result.revisionId;
}

/**
 * Append a public revision in one step (no draft). Use when you have nothing
 * to stage.
 */
export async function publishPublic(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		entryId: number;
		blobObjectId: BlobObjectId;
	},
): Promise<number> {
	const result = await publishDirect(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		collectionName: "blog",
		entryId: args.entryId,
		blobObjectId: args.blobObjectId,
		contentType: "text/plain",
	});
	return result.revisionId;
}

/**
 * Delete an entry. Removes all revisions; the entry ID is permanently retired
 * (subsequent ID allocation skips it). Missing entry surfaces as
 * `ContractAbortError { module: "collection", reason: "EEntryNotFound" }`.
 */
export async function removePost(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		entryId: number;
	},
): Promise<void> {
	await deleteEntry(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		collectionName: "blog",
		entryId: args.entryId,
	});
}
