/**
 * Narrow `Pick<SuiGrpcClient, ...>` interfaces used by the SDK.
 * A full `SuiGrpcClient` satisfies all of these structurally.
 */

import type { SuiGrpcClient } from "@mysten/sui/grpc";

// Read

/** RPC methods for single-object reads, ownership lookup, and dynamic fields. */
export type ObjectReader = Pick<
	SuiGrpcClient,
	"getObject" | "listOwnedObjects" | "listDynamicFields"
>;

/** Batch `getObjects`, used when resolving many IDs at once. */
export type BatchObjectReader = Pick<SuiGrpcClient, "getObjects">;

// Write

/** RPC methods needed to sign, submit, and await a transaction. */
export type TransactionExecutor = Pick<
	SuiGrpcClient,
	"signAndExecuteTransaction" | "waitForTransaction"
>;
