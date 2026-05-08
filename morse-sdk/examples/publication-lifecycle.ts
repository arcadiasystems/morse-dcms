/**
 * Publication lifecycle: create, transfer ownership, delete.
 *
 * A publication is a shared Sui object owned via an `OwnerCap` (transferable;
 * grants governance rights) and writeable via `PublisherCap`s (separate;
 * issued by the OwnerCap holder). One PublisherCap is created and transferred
 * to the publication creator at creation time so the same key can immediately
 * write content.
 *
 * Function names in this file are illustrative. Substitute your own.
 */

import type { OwnerCapId, PublicationId, SuiAddress } from "morse-sdk";
import {
	createPublication,
	deletePublication,
	transferOwnership,
} from "morse-sdk";
import type { ExampleContext } from "./setup.js";

/**
 * Create a publication. Slugs are validated client-side (lowercase
 * alphanumerics + hyphens, no leading/trailing hyphen, max 64 chars). The
 * Move layer also rejects duplicate slugs across active publications via
 * `ESlugAlreadyExists`.
 */
export async function createMyPublication(
	ctx: ExampleContext,
	args: { name: string; slug: string },
): Promise<{
	publicationId: PublicationId;
	ownerCapId: OwnerCapId;
}> {
	const result = await createPublication(ctx.adapter, ctx.config, {
		name: args.name,
		slug: args.slug,
	});
	console.log(
		`created publication ${result.publicationId}; ownerCap=${result.ownerCapId}, publisherCap=${result.publisherCapId}`,
	);
	return {
		publicationId: result.publicationId,
		ownerCapId: result.ownerCapId,
	};
}

/**
 * Transfer the OwnerCap to a new address. The recipient gains the right to
 * issue/revoke PublisherCaps and to delete the publication. Existing
 * PublisherCaps remain usable until revoked or destroyed.
 */
export async function handOffOwnership(
	ctx: ExampleContext,
	args: { ownerCapId: OwnerCapId; newOwner: SuiAddress },
): Promise<void> {
	await transferOwnership(ctx.adapter, ctx.config, {
		ownerCapId: args.ownerCapId,
		recipient: args.newOwner,
	});
}

/**
 * Delete a publication. Pre-flight: the SDK reads the publication and rejects
 * the call if any collections still exist (Move would abort
 * `table::destroy_empty` unnamed). Remove all collections first.
 *
 * Race window: between the read and the submit, another tx can add a
 * collection; the on-chain abort then surfaces as `ContractAbortError`.
 */
export async function tearDownPublication(
	ctx: ExampleContext,
	args: { publicationId: PublicationId; ownerCapId: OwnerCapId },
): Promise<void> {
	await deletePublication(ctx.reader, ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		ownerCapId: args.ownerCapId,
	});
}
