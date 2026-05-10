/**
 * Runtime codecs: branded-ID constructors and enum converters between
 * TypeScript values and on-chain Move representations.
 */

import { ValidationError } from "./errors.js";
import {
	AccessPolicy,
	type BlobObjectId,
	type OwnerCapId,
	type PackageId,
	type PublicationId,
	type PublisherCapId,
	QUILT_PATCH_ID_LENGTH,
	type QuiltPatchId,
	type RegistryId,
	StorageMode,
	type SuiAddress,
	type SuiObjectId,
	type WalrusBlobId,
} from "./types.js";

// ID validation

/** `0x` + 1 to 64 lowercase hex chars. */
const OBJECT_ID_PATTERN = /^0x[0-9a-f]{1,64}$/;
const OBJECT_ID_HEX_LENGTH = 64;

/**
 * Validate the input shape and return its zero-padded canonical form.
 * Sui represents object IDs as 32-byte values rendered `0x`+64 hex chars.
 * Short forms (e.g. `"0x1"`) are accepted as input — they're convenient in
 * Move source — but the brand always carries the canonical 64-char form so
 * downstream string equality works against RPC responses (which are always
 * canonical).
 */
function normalizeObjectId(value: string, field: string): string {
	if (!OBJECT_ID_PATTERN.test(value)) {
		throw new ValidationError(
			`Invalid ${field}: expected lowercase hex prefixed with "0x" and up to 64 hex characters, got ${JSON.stringify(value)}`,
			field,
		);
	}
	const hex = value.slice(2);
	if (hex.length === OBJECT_ID_HEX_LENGTH) {
		return value;
	}
	return `0x${hex.padStart(OBJECT_ID_HEX_LENGTH, "0")}`;
}

/**
 * Construct a `PackageId`. Input may be `0x` + 1-64 lowercase hex chars;
 * the result is always zero-padded to 64 hex chars (Sui canonical form).
 * @throws {ValidationError} On invalid shape.
 */
export function toPackageId(value: string): PackageId {
	return normalizeObjectId(value, "PackageId") as PackageId;
}

/** Construct a `RegistryId`. Input is normalized to canonical 64-char form. @throws {ValidationError} On invalid shape. */
export function toRegistryId(value: string): RegistryId {
	return normalizeObjectId(value, "RegistryId") as RegistryId;
}

/** Construct a `PublicationId`. Input is normalized to canonical 64-char form. @throws {ValidationError} On invalid shape. */
export function toPublicationId(value: string): PublicationId {
	return normalizeObjectId(value, "PublicationId") as PublicationId;
}

/** Construct an `OwnerCapId`. Input is normalized to canonical 64-char form. @throws {ValidationError} On invalid shape. */
export function toOwnerCapId(value: string): OwnerCapId {
	return normalizeObjectId(value, "OwnerCapId") as OwnerCapId;
}

/** Construct a `PublisherCapId`. Input is normalized to canonical 64-char form. @throws {ValidationError} On invalid shape. */
export function toPublisherCapId(value: string): PublisherCapId {
	return normalizeObjectId(value, "PublisherCapId") as PublisherCapId;
}

/** Construct a `BlobObjectId`. Input is normalized to canonical 64-char form. @throws {ValidationError} On invalid shape. */
export function toBlobObjectId(value: string): BlobObjectId {
	return normalizeObjectId(value, "BlobObjectId") as BlobObjectId;
}

/** Construct a `SuiAddress`. Input is normalized to canonical 64-char form. @throws {ValidationError} On invalid shape. */
export function toSuiAddress(value: string): SuiAddress {
	return normalizeObjectId(value, "SuiAddress") as SuiAddress;
}

/** Construct a `SuiObjectId`. Input is normalized to canonical 64-char form. @throws {ValidationError} On invalid shape. */
export function toSuiObjectId(value: string): SuiObjectId {
	return normalizeObjectId(value, "SuiObjectId") as SuiObjectId;
}

// Walrus blob id

/** URL-safe base64 alphabet, no padding. 43 chars carries 32 bytes. */
const WALRUS_BLOB_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Construct a `WalrusBlobId` from a URL-safe base64 string (43 chars,
 * unpadded). @throws {ValidationError} On invalid shape.
 */
export function toWalrusBlobId(value: string): WalrusBlobId {
	if (!WALRUS_BLOB_ID_PATTERN.test(value)) {
		throw new ValidationError(
			`Invalid WalrusBlobId: expected 43 URL-safe base64 chars (unpadded), got ${JSON.stringify(value)}`,
			"WalrusBlobId",
		);
	}
	return value as WalrusBlobId;
}

// Quilt patch id

/**
 * Construct a `QuiltPatchId` by validating length only. Use the structural
 * codec in `walrus/quilt-patch-id.ts` for `{quiltId, version, startIndex,
 * endIndex}` round-trips. @throws {ValidationError} On wrong length.
 */
export function toQuiltPatchId(bytes: Uint8Array): QuiltPatchId {
	if (bytes.length !== QUILT_PATCH_ID_LENGTH) {
		throw new ValidationError(
			`Invalid QuiltPatchId: expected ${QUILT_PATCH_ID_LENGTH} bytes, got ${bytes.length}`,
			"QuiltPatchId",
		);
	}
	return bytes as QuiltPatchId;
}

// Storage mode

/** Convert `StorageMode` to Move `u8`. */
export function storageModeToU8(mode: StorageMode): number {
	if (mode === StorageMode.Blob) {
		return 0;
	}
	return 1;
}

/** Convert Move `u8` to `StorageMode`. @throws {ValidationError} On unknown values. */
export function storageModeFromU8(value: number): StorageMode {
	if (value === 0) {
		return StorageMode.Blob;
	}
	if (value === 1) {
		return StorageMode.Quilt;
	}
	throw new ValidationError(
		`Invalid storage_mode: expected 0 (blob) or 1 (quilt), got ${value}`,
		"storage_mode",
	);
}

// Access policy

/** Convert `AccessPolicy` to Move `u8`. */
export function accessPolicyToU8(policy: AccessPolicy): number {
	if (policy === AccessPolicy.Public) {
		return 0;
	}
	if (policy === AccessPolicy.Publisher) {
		return 1;
	}
	return 2;
}

/** Convert Move `u8` to `AccessPolicy`. @throws {ValidationError} On unknown values. */
export function accessPolicyFromU8(value: number): AccessPolicy {
	if (value === 0) {
		return AccessPolicy.Public;
	}
	if (value === 1) {
		return AccessPolicy.Publisher;
	}
	if (value === 2) {
		return AccessPolicy.Subscription;
	}
	throw new ValidationError(
		`Invalid access_policy: expected 0, 1, or 2, got ${value}`,
		"access_policy",
	);
}
