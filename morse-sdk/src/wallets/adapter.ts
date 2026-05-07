/**
 * Wallet adapter interface. The SDK signs through implementations of this type,
 * never touching private keys directly.
 */

import type { Transaction } from "@mysten/sui/transactions";

import type { SuiAddress, TxReceipt } from "../types.js";

/**
 * Per-command return values from a simulated PTB. Outer index is the command
 * (in order added to the `Transaction`); inner index is the return value of
 * that command. Each value is BCS-encoded; decode with the matching
 * `@mysten/bcs` schema.
 */
export type SimulationReturnValues = ReadonlyArray<readonly Uint8Array[]>;

/** Signs and submits Move transactions on behalf of a single Sui account. */
export interface WalletAdapter {
	/** Active account at adapter construction time; switching requires a new instance. */
	readonly address: SuiAddress;

	/**
	 * Sign, submit, and await finality.
	 * @throws {ContractAbortError} On Move abort.
	 * @throws {TransportError} On RPC, network, or response-parsing failure.
	 */
	signAndExecuteTransaction(
		tx: Transaction,
		signal?: AbortSignal,
	): Promise<TxReceipt>;

	/**
	 * Dry-run a PTB and return per-command BCS-encoded return values. Used by
	 * ops that need values returned by Move calls (no other path on Sui without
	 * a contract upgrade for events). Subject to a snapshot-vs-execute race for
	 * shared-object reads; acceptable for single-publisher write paths.
	 * @throws {ContractAbortError} On simulated Move abort.
	 * @throws {TransportError} On RPC, network, or response-parsing failure.
	 */
	simulateTransaction(
		tx: Transaction,
		signal?: AbortSignal,
	): Promise<SimulationReturnValues>;
}
