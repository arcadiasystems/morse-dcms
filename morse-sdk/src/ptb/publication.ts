/**
 * PTB builders for publication-level Move calls. Internal to the SDK;
 * `ops/` composes these into single atomic transactions.
 */

import type {
	Transaction,
	TransactionArgument,
	TransactionObjectArgument,
	TransactionResult,
} from "@mysten/sui/transactions";

import type {
	OwnerCapId,
	PackageId,
	PublicationId,
	PublisherCapId,
	RegistryId,
	SuiAddress,
} from "../types.js";
import { resolveObjectArg } from "./internal.js";

export interface BuildCreatePublicationArgs {
	readonly packageId: PackageId;
	readonly registryId: RegistryId;
	readonly name: string;
	readonly slug: string;
}

/**
 * Add a `publication::new_publication` call. The result destructures into
 * `[publication, ownerCap, publisherCap]` in tuple order.
 */
export function buildCreatePublication(
	tx: Transaction,
	args: BuildCreatePublicationArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::new_publication`,
		arguments: [
			tx.object(args.registryId),
			tx.pure.string(args.name),
			tx.pure.string(args.slug),
		],
	});
}

export interface BuildSharePublicationArgs {
	readonly packageId: PackageId;
	readonly publication: TransactionArgument;
}

/** Add a `publication::share_publication` call. Consumes the publication. */
export function buildSharePublication(
	tx: Transaction,
	args: BuildSharePublicationArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::share_publication`,
		arguments: [args.publication],
	});
}

export interface BuildDeletePublicationArgs {
	readonly packageId: PackageId;
	readonly registryId: RegistryId;
	readonly publicationId: PublicationId;
	readonly ownerCapId: OwnerCapId;
}

/** Add a `publication::delete_publication` call. Consumes the publication and OwnerCap. */
export function buildDeletePublication(
	tx: Transaction,
	args: BuildDeletePublicationArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::delete_publication`,
		arguments: [
			tx.object(args.registryId),
			tx.object(args.publicationId),
			tx.object(args.ownerCapId),
		],
	});
}

export interface BuildTransferOwnerCapArgs {
	readonly packageId: PackageId;
	/** Existing `OwnerCapId` (will be wrapped via `tx.object`) or an Argument from a prior PTB step. */
	readonly ownerCap: OwnerCapId | TransactionObjectArgument;
	readonly recipient: SuiAddress;
}

/** Add a `publication::transfer_owner_cap` call. */
export function buildTransferOwnerCap(
	tx: Transaction,
	args: BuildTransferOwnerCapArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::transfer_owner_cap`,
		arguments: [
			resolveObjectArg(tx, args.ownerCap),
			tx.pure.address(args.recipient),
		],
	});
}

export interface BuildTransferPublisherCapArgs {
	readonly packageId: PackageId;
	/** Existing `PublisherCapId` (will be wrapped via `tx.object`) or an Argument from a prior PTB step. */
	readonly publisherCap: PublisherCapId | TransactionObjectArgument;
	readonly recipient: SuiAddress;
}

/**
 * Add a `publication::transfer_publisher_cap` call. Required because PublisherCap
 * is `key`-only and cannot be moved by `tx.transferObjects`.
 */
export function buildTransferPublisherCap(
	tx: Transaction,
	args: BuildTransferPublisherCapArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::transfer_publisher_cap`,
		arguments: [
			resolveObjectArg(tx, args.publisherCap),
			tx.pure.address(args.recipient),
		],
	});
}
