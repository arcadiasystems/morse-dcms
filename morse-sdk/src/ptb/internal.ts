/**
 * Shared helpers for PTB builders. Internal to `ptb/`; not exported from
 * `src/index.ts`.
 */

import type {
	Transaction,
	TransactionObjectArgument,
} from "@mysten/sui/transactions";

/**
 * Wrap a string ID into a `tx.object()` reference, or pass through an existing
 * Argument unchanged. Lets builders accept either form for ergonomics.
 */
export function resolveObjectArg(
	tx: Transaction,
	value: string | TransactionObjectArgument,
): TransactionObjectArgument {
	return typeof value === "string" ? tx.object(value) : value;
}
