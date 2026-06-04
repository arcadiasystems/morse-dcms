/**
 * High-level allowlist ops: build a PTB, sign and execute via the wallet
 * adapter, parse the receipt into a typed result.
 */

import {
	Transaction,
	type TransactionObjectArgument,
} from "@mysten/sui/transactions";

import { toAllowlistCapId, toAllowlistId } from "../codecs.js";
import type { MorsePackageConfig } from "../config.js";
import { ValidationError } from "../errors.js";
import {
	buildAddMember,
	buildDeleteAllowlist,
	buildNewAllowlist,
	buildRemoveMember,
	buildShareAllowlist,
	buildTransferAllowlistCap,
} from "../ptb/allowlist.js";
import type { AllowlistCapId, AllowlistId, SuiAddress } from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import { findCreatedId } from "./internal.js";

const MAX_ALLOWLIST_NAME_LENGTH = 256;

export interface CreateAllowlistArgs {
	readonly name: string;
	readonly signal?: AbortSignal;
}

export interface CreateAllowlistResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
	readonly allowlistId: AllowlistId;
	readonly capId: AllowlistCapId;
}

/**
 * Create an allowlist, share it, and transfer the admin Cap to `adapter.address`
 * in one atomic PTB. The caller can immediately use the returned `capId`
 * for member ops.
 *
 * @throws {ValidationError} If `name` is empty or exceeds 256 chars.
 * @throws {ContractAbortError} On Move abort.
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function createAllowlist(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: CreateAllowlistArgs,
): Promise<CreateAllowlistResult> {
	validateAllowlistName(args.name);

	const tx = new Transaction();
	const created = buildNewAllowlist(tx, {
		packageId: config.packageId,
		name: args.name,
	});
	const allowlistArg = created[0] as TransactionObjectArgument;
	const capArg = created[1] as TransactionObjectArgument;
	buildShareAllowlist(tx, {
		packageId: config.packageId,
		allowlist: allowlistArg,
	});
	buildTransferAllowlistCap(tx, {
		packageId: config.packageId,
		cap: capArg,
		recipient: adapter.address,
	});

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	// Sui types are identified by the package id where the type was DEFINED.
	// allowlist::Allowlist was introduced in the v2 upgrade, so its type
	// identity is rooted at config.packageId (v2 published-at), not at
	// originalPackageId (v1 genesis, used by publication / collection / entry).
	const typePrefix = config.packageId;

	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		allowlistId: toAllowlistId(
			findCreatedId(receipt, `${typePrefix}::allowlist::Allowlist`),
		),
		capId: toAllowlistCapId(
			findCreatedId(receipt, `${typePrefix}::allowlist::Cap`),
		),
	};
}

export interface AddMemberArgs {
	readonly allowlistId: AllowlistId;
	readonly capId: AllowlistCapId;
	readonly member: SuiAddress;
	readonly signal?: AbortSignal;
}

export interface AllowlistOpResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
}

/**
 * Add an address to the allowlist. Idempotent: adding an existing member
 * aborts with `EMemberAlreadyPresent`.
 *
 * @throws {ContractAbortError} On Move abort (wrong cap, duplicate member).
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function addMember(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: AddMemberArgs,
): Promise<AllowlistOpResult> {
	const tx = new Transaction();
	buildAddMember(tx, {
		packageId: config.packageId,
		allowlistId: args.allowlistId,
		capId: args.capId,
		member: args.member,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

export interface RemoveMemberArgs {
	readonly allowlistId: AllowlistId;
	readonly capId: AllowlistCapId;
	readonly member: SuiAddress;
	readonly signal?: AbortSignal;
}

/**
 * Remove an address from the allowlist. Aborts with `EMemberNotPresent` if
 * the address is not a member.
 */
export async function removeMember(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: RemoveMemberArgs,
): Promise<AllowlistOpResult> {
	const tx = new Transaction();
	buildRemoveMember(tx, {
		packageId: config.packageId,
		allowlistId: args.allowlistId,
		capId: args.capId,
		member: args.member,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

export interface TransferAllowlistCapArgs {
	readonly capId: AllowlistCapId;
	readonly recipient: SuiAddress;
	readonly signal?: AbortSignal;
}

/**
 * Transfer the admin Cap to a new address. The new holder gains full admin
 * rights; the previous holder loses them.
 */
export async function transferAllowlistCap(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: TransferAllowlistCapArgs,
): Promise<AllowlistOpResult> {
	const tx = new Transaction();
	buildTransferAllowlistCap(tx, {
		packageId: config.packageId,
		cap: args.capId,
		recipient: args.recipient,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

export interface DeleteAllowlistArgs {
	readonly allowlistId: AllowlistId;
	readonly capId: AllowlistCapId;
	readonly signal?: AbortSignal;
}

/**
 * Delete an allowlist. Any `EncryptedFile` still referencing this allowlist
 * becomes unusable for decryption (`seal_approve` dry-run will fail with
 * `ESealInvalidId` because the allowlist object no longer exists). Delete
 * dependent files first or migrate them before deleting the allowlist.
 */
export async function deleteAllowlist(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: DeleteAllowlistArgs,
): Promise<AllowlistOpResult> {
	const tx = new Transaction();
	buildDeleteAllowlist(tx, {
		packageId: config.packageId,
		allowlistId: args.allowlistId,
		capId: args.capId,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

function validateAllowlistName(name: string): void {
	if (name.length === 0) {
		throw new ValidationError("Allowlist name cannot be empty", "name");
	}
	if (name.length > MAX_ALLOWLIST_NAME_LENGTH) {
		throw new ValidationError(
			`Allowlist name exceeds ${MAX_ALLOWLIST_NAME_LENGTH} chars`,
			"name",
		);
	}
}
