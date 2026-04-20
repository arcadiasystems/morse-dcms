/**
 * Wallet adapter interface. The SDK signs through implementations of this type,
 * never touching private keys directly.
 */

import type { Transaction } from "@mysten/sui/transactions";

import type { SuiAddress, TxReceipt } from "../types.js";

/** Signs and submits Move transactions on behalf of a single Sui account. */
export interface WalletAdapter {
	/** Active account at adapter construction time; switching requires a new instance. */
	readonly address: SuiAddress;

	/**
	 * Sign, submit, and await finality.
	 * @throws {ContractAbortError} On Move abort.
	 * @throws {MorseError} On other failures.
	 */
	signAndExecuteTransaction(tx: Transaction): Promise<TxReceipt>;
}
