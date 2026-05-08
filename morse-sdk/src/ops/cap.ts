/**
 * High-level PublisherCap lifecycle ops: issue, revoke, destroy.
 */

import {
	Transaction,
	type TransactionObjectArgument,
} from "@mysten/sui/transactions";

import { toPublisherCapId } from "../codecs.js";
import type { MorsePackageConfig } from "../config.js";
import {
	buildDestroyPublisherCap,
	buildIssuePublisherCap,
	buildRevokePublisherCap,
} from "../ptb/cap.js";
import { buildTransferPublisherCap } from "../ptb/publication.js";
import type {
	OwnerCapId,
	PublicationId,
	PublisherCapId,
	SuiAddress,
} from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import { findCreatedId } from "./internal.js";

export interface IssuePublisherCapArgs {
	readonly publicationId: PublicationId;
	readonly ownerCapId: OwnerCapId;
	readonly holder: SuiAddress;
	readonly signal?: AbortSignal;
}

export interface IssuePublisherCapResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
	readonly publisherCapId: PublisherCapId;
}

/**
 * Issue a new PublisherCap and atomically transfer it to its bound `holder`
 * inside the same PTB. The cap is bound to `holder` for write-permission
 * checks regardless of where the object lives.
 * @throws {ContractAbortError} On Move abort (e.g. ownerCap mismatch).
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function issuePublisherCap(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: IssuePublisherCapArgs,
): Promise<IssuePublisherCapResult> {
	const tx = new Transaction();
	const created = buildIssuePublisherCap(tx, {
		packageId: config.packageId,
		publicationId: args.publicationId,
		ownerCap: args.ownerCapId,
		holder: args.holder,
	});
	// issue_publisher_cap returns a single PublisherCap. TransactionResult is
	// typed as the array branch of TransactionArgument intersected with a
	// single Result; the double cast narrows to the object-argument form
	// expected by downstream PTB calls.
	const capArg = created as unknown as TransactionObjectArgument;
	buildTransferPublisherCap(tx, {
		packageId: config.packageId,
		publisherCap: capArg,
		recipient: args.holder,
	});

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	const typePrefix = config.originalPackageId ?? config.packageId;

	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		publisherCapId: toPublisherCapId(
			findCreatedId(receipt, `${typePrefix}::publication::PublisherCap`),
		),
	};
}

export interface RevokePublisherCapArgs {
	readonly publicationId: PublicationId;
	readonly ownerCapId: OwnerCapId;
	readonly publisherCapId: PublisherCapId;
	readonly signal?: AbortSignal;
}

export interface RevokePublisherCapResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
}

/**
 * Revoke a PublisherCap. Adds the cap ID to the publication's denylist; future
 * write operations using that cap will abort with `EPublisherCapRevoked`.
 * @throws {ContractAbortError} On Move abort (e.g. cap already revoked).
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function revokePublisherCap(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: RevokePublisherCapArgs,
): Promise<RevokePublisherCapResult> {
	const tx = new Transaction();
	buildRevokePublisherCap(tx, {
		packageId: config.packageId,
		publicationId: args.publicationId,
		ownerCap: args.ownerCapId,
		publisherCapId: args.publisherCapId,
	});

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);

	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
	};
}

export interface DestroyPublisherCapArgs {
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly signal?: AbortSignal;
}

export interface DestroyPublisherCapResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
}

/**
 * Destroy a PublisherCap. Cleans the denylist entry if the cap was previously
 * revoked. The Move layer enforces that `ctx.sender()` matches the cap's
 * bound `holder`; call `reader.getPublisherCap` first if you want to validate
 * before spending gas.
 * @throws {ContractAbortError} On Move abort (e.g. wrong holder).
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function destroyPublisherCap(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: DestroyPublisherCapArgs,
): Promise<DestroyPublisherCapResult> {
	const tx = new Transaction();
	buildDestroyPublisherCap(tx, {
		packageId: config.packageId,
		publicationId: args.publicationId,
		publisherCap: args.publisherCapId,
	});

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);

	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
	};
}

export interface TransferPublisherCapArgs {
	readonly publisherCapId: PublisherCapId;
	readonly recipient: SuiAddress;
	readonly signal?: AbortSignal;
}

export interface TransferPublisherCapResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
}

/**
 * Transfer a PublisherCap to a new address. The cap remains bound to its
 * original `holder`; transferring changes object ownership but not write
 * authority. To move write authority, the original holder destroys the cap
 * and the OwnerCap holder issues a new one to the target address.
 * @throws {ContractAbortError} On Move abort.
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function transferPublisherCap(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: TransferPublisherCapArgs,
): Promise<TransferPublisherCapResult> {
	const tx = new Transaction();
	buildTransferPublisherCap(tx, {
		packageId: config.packageId,
		publisherCap: args.publisherCapId,
		recipient: args.recipient,
	});

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);

	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
	};
}
