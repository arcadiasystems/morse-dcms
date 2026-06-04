/**
 * PTB builders for `allowlist` module Move calls. Internal to the SDK;
 * `ops/allowlist.ts` composes these into single atomic transactions.
 */

import type {
	Transaction,
	TransactionArgument,
	TransactionResult,
} from "@mysten/sui/transactions";

import type {
	AllowlistCapId,
	AllowlistId,
	PackageId,
	SuiAddress,
} from "../types.js";

export interface BuildNewAllowlistArgs {
	readonly packageId: PackageId;
	readonly name: string;
}

/**
 * Add an `allowlist::new_allowlist` call. The result destructures into
 * `[allowlist, cap]` in tuple order.
 */
export function buildNewAllowlist(
	tx: Transaction,
	args: BuildNewAllowlistArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::allowlist::new_allowlist`,
		arguments: [tx.pure.string(args.name)],
	});
}

export interface BuildShareAllowlistArgs {
	readonly packageId: PackageId;
	readonly allowlist: TransactionArgument;
}

/** Add an `allowlist::share_allowlist` call. Consumes the allowlist. */
export function buildShareAllowlist(
	tx: Transaction,
	args: BuildShareAllowlistArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::allowlist::share_allowlist`,
		arguments: [args.allowlist],
	});
}

export interface BuildTransferAllowlistCapArgs {
	readonly packageId: PackageId;
	readonly cap: TransactionArgument | AllowlistCapId;
	readonly recipient: SuiAddress;
}

/**
 * Add an `allowlist::transfer_cap` call. Use this instead of `tx.transferObjects`
 * because `Cap` is key-only (no `store`); the contract's typed transfer is the
 * only way to move it.
 */
export function buildTransferAllowlistCap(
	tx: Transaction,
	args: BuildTransferAllowlistCapArgs,
): TransactionResult {
	const cap = typeof args.cap === "string" ? tx.object(args.cap) : args.cap;
	return tx.moveCall({
		target: `${args.packageId}::allowlist::transfer_cap`,
		arguments: [cap, tx.pure.address(args.recipient)],
	});
}

export interface BuildAddMemberArgs {
	readonly packageId: PackageId;
	readonly allowlistId: AllowlistId;
	readonly capId: AllowlistCapId;
	readonly member: SuiAddress;
}

export function buildAddMember(
	tx: Transaction,
	args: BuildAddMemberArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::allowlist::add_member`,
		arguments: [
			tx.object(args.allowlistId),
			tx.object(args.capId),
			tx.pure.address(args.member),
		],
	});
}

export interface BuildRemoveMemberArgs {
	readonly packageId: PackageId;
	readonly allowlistId: AllowlistId;
	readonly capId: AllowlistCapId;
	readonly member: SuiAddress;
}

export function buildRemoveMember(
	tx: Transaction,
	args: BuildRemoveMemberArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::allowlist::remove_member`,
		arguments: [
			tx.object(args.allowlistId),
			tx.object(args.capId),
			tx.pure.address(args.member),
		],
	});
}

export interface BuildDeleteAllowlistArgs {
	readonly packageId: PackageId;
	readonly allowlistId: AllowlistId;
	readonly capId: AllowlistCapId;
}

export function buildDeleteAllowlist(
	tx: Transaction,
	args: BuildDeleteAllowlistArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::allowlist::delete_allowlist`,
		arguments: [tx.object(args.allowlistId), tx.object(args.capId)],
	});
}

export interface BuildSealApproveAllowlistArgs {
	readonly packageId: PackageId;
	readonly identity: Uint8Array;
	readonly allowlistId: AllowlistId;
}

/**
 * Add a dry-run-only `allowlist::seal_approve` call. Seal key servers execute
 * this against a dry-run of the PTB to decide whether to release decryption
 * key shares; the transaction is not submitted on-chain. The `identity` bytes
 * must be the same `SealId` used to encrypt the content.
 */
export function buildSealApproveAllowlist(
	tx: Transaction,
	args: BuildSealApproveAllowlistArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::allowlist::seal_approve`,
		arguments: [
			tx.pure.vector("u8", Array.from(args.identity)),
			tx.object(args.allowlistId),
		],
	});
}
