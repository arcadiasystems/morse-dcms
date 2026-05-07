/**
 * High-level collection ops: create and delete collections within a publication.
 */

import { Transaction } from "@mysten/sui/transactions";

import type { MorsePackageConfig } from "../config.js";
import {
	buildCreateCollection,
	buildDeleteCollection,
} from "../ptb/collection.js";
import type { PublicationId, PublisherCapId, StorageMode } from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";

export interface CreateCollectionArgs {
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly name: string;
	readonly storageMode: StorageMode;
	readonly signal?: AbortSignal;
}

export interface CreateCollectionResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
}

/**
 * Add a new collection to a publication. Collections live inline in the
 * publication's `VecMap`, so no Sui object is created and the receipt
 * carries no created object ID.
 * @throws {ContractAbortError} On Move abort (e.g. duplicate name -> `ECollectionAlreadyExists`).
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function createCollection(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: CreateCollectionArgs,
): Promise<CreateCollectionResult> {
	const tx = new Transaction();
	buildCreateCollection(tx, {
		packageId: config.packageId,
		publication: args.publicationId,
		publisherCap: args.publisherCapId,
		name: args.name,
		storageMode: args.storageMode,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
	};
}

export interface DeleteCollectionArgs {
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly name: string;
	readonly signal?: AbortSignal;
}

export interface DeleteCollectionResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
}

/**
 * Remove a collection from a publication. No client-side preflight; the
 * Move layer aborts unnamed (`UnknownAbort`) in two cases:
 *
 * - The collection name is not in the publication's VecMap (`vec_map::remove`).
 * - The collection's entries table is non-empty (`table::destroy_empty`).
 *
 * Consumers wanting certainty before spending gas should fetch the
 * publication via `getPublication` and inspect `collections` first.
 *
 * @throws {ContractAbortError} On Move abort.
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function deleteCollection(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: DeleteCollectionArgs,
): Promise<DeleteCollectionResult> {
	const tx = new Transaction();
	buildDeleteCollection(tx, {
		packageId: config.packageId,
		publication: args.publicationId,
		publisherCap: args.publisherCapId,
		name: args.name,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
	};
}
