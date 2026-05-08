/**
 * Collection lifecycle: create (with storage mode), delete.
 *
 * `storageMode` is set at creation and cannot change. Pick:
 * - `Blob`: one Walrus blob per revision. Larger payloads, infrequent writes.
 * - `Quilt`: many revisions share one Walrus blob via patch IDs. Cheaper at
 *   scale; payloads must be packed together at upload time.
 *
 * Collections live inline in the publication's `VecMap`, so creating a
 * collection does not create a separate Sui object; the publication's version
 * bumps. Names must be unique within a publication.
 *
 * Function names below pick `Blog`/`Image` to suggest typical use, but the
 * storage mode is independent of the name. Substitute your own.
 */

import type { PublicationId, PublisherCapId } from "morse-sdk";
import { createCollection, deleteCollection, StorageMode } from "morse-sdk";
import type { ExampleContext } from "./setup.js";

/**
 * Create a blob-mode collection. Use for most CMS content where each entry
 * has a distinct payload (markdown posts, documents, large images).
 */
export async function createBlogCollection(
	ctx: ExampleContext,
	args: { publicationId: PublicationId; publisherCapId: PublisherCapId },
): Promise<void> {
	await createCollection(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		name: "blog",
		storageMode: StorageMode.Blob,
	});
}

/**
 * Create a quilt-mode collection. Use when you have many small payloads (per
 * entry) that benefit from being packed together at upload time. Each entry's
 * BlobRef points to the same Walrus blob with a different `patchId`.
 */
export async function createImageCollection(
	ctx: ExampleContext,
	args: { publicationId: PublicationId; publisherCapId: PublisherCapId },
): Promise<void> {
	await createCollection(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		name: "images",
		storageMode: StorageMode.Quilt,
	});
}

/**
 * Delete a collection. The Move layer aborts (unnamed) if entries still
 * exist; the on-chain `table::destroy_empty` requires an empty entries table.
 * Delete all entries first.
 */
export async function tearDownCollection(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		name: string;
	},
): Promise<void> {
	await deleteCollection(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		name: args.name,
	});
}
