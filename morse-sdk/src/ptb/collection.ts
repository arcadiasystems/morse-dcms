/**
 * PTB builders for collection lifecycle Move calls. Internal to the SDK.
 */

import type {
	Transaction,
	TransactionObjectArgument,
	TransactionResult,
} from "@mysten/sui/transactions";

import { storageModeToU8 } from "../codecs.js";
import type {
	PackageId,
	PublicationId,
	PublisherCapId,
	StorageMode,
} from "../types.js";
import { resolveObjectArg } from "./internal.js";

export interface BuildCreateCollectionArgs {
	readonly packageId: PackageId;
	readonly publication: PublicationId | TransactionObjectArgument;
	readonly publisherCap: PublisherCapId | TransactionObjectArgument;
	readonly name: string;
	readonly storageMode: StorageMode;
}

/** Add a `publication::create_collection` call. */
export function buildCreateCollection(
	tx: Transaction,
	args: BuildCreateCollectionArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::create_collection`,
		arguments: [
			resolveObjectArg(tx, args.publication),
			resolveObjectArg(tx, args.publisherCap),
			tx.pure.string(args.name),
			tx.pure.u8(storageModeToU8(args.storageMode)),
		],
	});
}

export interface BuildDeleteCollectionArgs {
	readonly packageId: PackageId;
	readonly publication: PublicationId | TransactionObjectArgument;
	readonly publisherCap: PublisherCapId | TransactionObjectArgument;
	readonly name: string;
}

/**
 * Add a `publication::delete_collection` call. The collection's entries
 * table must be empty; otherwise the on-chain `table::destroy_empty` aborts
 * with no named code, surfacing as `UnknownAbort`.
 */
export function buildDeleteCollection(
	tx: Transaction,
	args: BuildDeleteCollectionArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::delete_collection`,
		arguments: [
			resolveObjectArg(tx, args.publication),
			resolveObjectArg(tx, args.publisherCap),
			tx.pure.string(args.name),
		],
	});
}
