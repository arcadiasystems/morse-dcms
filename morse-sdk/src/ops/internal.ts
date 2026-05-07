/**
 * Shared helpers for ops. Internal to `ops/`; not exported from `src/index.ts`.
 */

import { bcs } from "@mysten/sui/bcs";

import { TransportError } from "../errors.js";
import type { TxReceipt } from "../types.js";
import type { SimulationReturnValues } from "../wallets/adapter.js";

/**
 * Find the object ID of the single created object whose type exactly matches
 * `expectedType`. Used to extract typed handles from a transaction receipt.
 *
 * @throws {TransportError} If no created object matches the expected type.
 */
export function findCreatedId(
	receipt: TxReceipt,
	expectedType: string,
): string {
	const created = receipt.createdObjects.find(
		(object) => object.objectType === expectedType,
	);
	if (!created) {
		throw new TransportError(
			`Receipt is missing a created object of type ${expectedType}`,
		);
	}
	return created.objectId;
}

/**
 * Decode a `u64` return value from a simulated PTB. Validates the result is a
 * safe JS integer; on overflow or shape mismatch, throws `TransportError`.
 *
 * @throws {TransportError} If the indices are out of range or the value
 *   exceeds `Number.MAX_SAFE_INTEGER`.
 */
export function decodeU64ReturnValue(
	values: SimulationReturnValues,
	commandIndex: number,
	returnIndex: number,
): number {
	const command = values[commandIndex];
	if (!command) {
		throw new TransportError(
			`Simulation has no command at index ${commandIndex} (got ${values.length} commands)`,
		);
	}
	const bytes = command[returnIndex];
	if (!bytes) {
		throw new TransportError(
			`Simulation command ${commandIndex} has no return value at index ${returnIndex} (got ${command.length} return values)`,
		);
	}
	const decoded = bcs.u64().parse(bytes);
	const asNumber = Number(decoded);
	if (!Number.isSafeInteger(asNumber)) {
		throw new TransportError(
			`Simulated u64 return value ${decoded} exceeds Number.MAX_SAFE_INTEGER`,
		);
	}
	return asNumber;
}
