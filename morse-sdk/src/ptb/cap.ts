/**
 * PTB builders for PublisherCap lifecycle Move calls. Internal to the SDK.
 */

import type {
	Transaction,
	TransactionObjectArgument,
	TransactionResult,
} from "@mysten/sui/transactions";

import type {
	OwnerCapId,
	PackageId,
	PublicationId,
	PublisherCapId,
	SuiAddress,
} from "../types.js";
import { resolveObjectArg } from "./internal.js";

export interface BuildIssuePublisherCapArgs {
	readonly packageId: PackageId;
	readonly publicationId: PublicationId | TransactionObjectArgument;
	readonly ownerCap: OwnerCapId | TransactionObjectArgument;
	readonly holder: SuiAddress;
}

/**
 * Add a `publication::issue_publisher_cap` call. Returns the result handle for
 * the freshly-minted `PublisherCap`; caller is responsible for transferring it
 * to the bound holder address (typically via `buildTransferPublisherCap`).
 */
export function buildIssuePublisherCap(
	tx: Transaction,
	args: BuildIssuePublisherCapArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::issue_publisher_cap`,
		arguments: [
			resolveObjectArg(tx, args.publicationId),
			resolveObjectArg(tx, args.ownerCap),
			tx.pure.address(args.holder),
		],
	});
}

export interface BuildRevokePublisherCapArgs {
	readonly packageId: PackageId;
	readonly publicationId: PublicationId | TransactionObjectArgument;
	readonly ownerCap: OwnerCapId | TransactionObjectArgument;
	readonly publisherCapId: PublisherCapId;
}

/** Add a `publication::revoke_publisher_cap` call. Adds the cap ID to the denylist. */
export function buildRevokePublisherCap(
	tx: Transaction,
	args: BuildRevokePublisherCapArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::revoke_publisher_cap`,
		arguments: [
			resolveObjectArg(tx, args.publicationId),
			resolveObjectArg(tx, args.ownerCap),
			tx.pure.id(args.publisherCapId),
		],
	});
}

export interface BuildDestroyPublisherCapArgs {
	readonly packageId: PackageId;
	readonly publicationId: PublicationId | TransactionObjectArgument;
	readonly publisherCap: PublisherCapId | TransactionObjectArgument;
}

/**
 * Add a `publication::destroy_publisher_cap` call. Consumes the cap; only the
 * cap's bound holder may call this.
 */
export function buildDestroyPublisherCap(
	tx: Transaction,
	args: BuildDestroyPublisherCapArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::destroy_publisher_cap`,
		arguments: [
			resolveObjectArg(tx, args.publicationId),
			resolveObjectArg(tx, args.publisherCap),
		],
	});
}
