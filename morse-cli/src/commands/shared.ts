/** Small argument parsers shared across command modules. */

import { StorageMode } from "@arcadiasystems/morse-sdk";

import { UsageError } from "../cli/errors.ts";

const STORAGE_MODES: ReadonlySet<string> = new Set(Object.values(StorageMode));

/** Validate a collection storage-mode flag. */
export function coerceStorageMode(value: string): StorageMode {
	if (STORAGE_MODES.has(value)) {
		return value as StorageMode;
	}
	throw new UsageError(
		`--mode must be one of: ${Object.values(StorageMode).join(", ")}, got "${value}".`,
	);
}

/** Parse a positive integer flag value. */
export function parsePositiveInt(value: string, name: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new UsageError(`${name} must be a positive integer, got "${value}".`);
	}
	return parsed;
}

/** Parse a positive integer limit flag. */
export function parseLimit(value: string): number {
	return parsePositiveInt(value, "--limit");
}

/** Parse a non-negative integer ID argument (entry id, revision id). */
export function parseId(value: string, name: string): number {
	const id = Number(value);
	if (!Number.isInteger(id) || id < 0) {
		throw new UsageError(
			`${name} must be a non-negative integer, got "${value}".`,
		);
	}
	return id;
}
