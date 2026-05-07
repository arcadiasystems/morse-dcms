/**
 * Shared helpers for ops. Internal to `ops/`; not exported from `src/index.ts`.
 */

import { TransportError } from "../errors.js";
import type { TxReceipt } from "../types.js";

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
