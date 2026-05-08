/**
 * PublisherCap lifecycle: issue (delegate write access), transfer (move the
 * Sui object), revoke (deny on-chain check), destroy (remove from the
 * denylist).
 *
 * Why two layers: a PublisherCap is bound at issue time to a `holder`
 * address. That binding is the on-chain authority; transferring the Sui
 * object to a different address does NOT grant the new holder write rights.
 * To rotate authority, destroy the old cap and issue a fresh one to the new
 * address.
 *
 * Production browser flows: issuing/revoking is governance work, typically
 * gated behind an admin UI calling `WalletAdapter` against a wallet-standard
 * signer (the SDK ships `KeypairAdapter` for server/CLI; browser apps
 * implement the interface against their connected wallet).
 *
 * Function names in this file are illustrative.
 */

import type {
	OwnerCapId,
	PublicationId,
	PublisherCapId,
	SuiAddress,
} from "morse-sdk";
import {
	destroyPublisherCap,
	issuePublisherCap,
	revokePublisherCap,
	transferPublisherCap,
} from "morse-sdk";
import type { ExampleContext } from "./setup.js";

/**
 * Issue a PublisherCap to a holder. The Sui object is atomically transferred
 * to `holder` inside the same PTB. Multiple caps can exist per publication;
 * each is independently revocable.
 */
export async function delegateWriteAccess(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		ownerCapId: OwnerCapId;
		holder: SuiAddress;
	},
): Promise<PublisherCapId> {
	const result = await issuePublisherCap(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		ownerCapId: args.ownerCapId,
		holder: args.holder,
	});
	return result.publisherCapId;
}

/**
 * Transfer a PublisherCap object. Note: the on-chain holder binding does not
 * change. The new owner can read the cap but cannot use it to write content
 * unless they are the originally-bound holder. To grant write authority,
 * destroy and re-issue.
 */
export async function movePublisherCap(
	ctx: ExampleContext,
	args: { publisherCapId: PublisherCapId; recipient: SuiAddress },
): Promise<void> {
	await transferPublisherCap(ctx.adapter, ctx.config, {
		publisherCapId: args.publisherCapId,
		recipient: args.recipient,
	});
}

/**
 * Revoke a PublisherCap. Adds the cap ID to the publication's denylist.
 * Subsequent writes using that cap abort with `EPublisherCapRevoked`.
 * Revocation is permanent for that cap ID; issue a fresh cap to re-grant.
 */
export async function revokeAccess(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		ownerCapId: OwnerCapId;
		publisherCapId: PublisherCapId;
	},
): Promise<void> {
	await revokePublisherCap(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		ownerCapId: args.ownerCapId,
		publisherCapId: args.publisherCapId,
	});
}

/**
 * Destroy a PublisherCap object. The cap holder calls this; ctx.sender() must
 * match the bound holder. Cleans up the denylist entry if the cap was
 * previously revoked.
 */
export async function destroyOwnPublisherCap(
	ctx: ExampleContext,
	args: { publicationId: PublicationId; publisherCapId: PublisherCapId },
): Promise<void> {
	await destroyPublisherCap(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
	});
}
