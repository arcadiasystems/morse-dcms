/**
 * Seal identity (`SealId`) construction and inspection for the allowlist policy.
 * The Move layer (`allowlist::seal_approve`) enforces the byte format, so both
 * encode and decode here must match the contract byte-for-byte.
 *
 * Layout: `allowlist_id(32) || policy_tag(u8=2) || nonce(>=1)`. Total length
 * must be > 33 bytes (`allowlist::ESealInvalidId` otherwise).
 *
 * Distinct from the publisher policy (`publisher-identity.ts`) by policy tag
 * (allowlist=2, publisher=1) so both can coexist in the same package without
 * identity collisions.
 */

import { ValidationError } from "../errors.js";
import { type AllowlistId, type SealId, SealPolicyTag } from "../types.js";

const ALLOWLIST_ID_BYTES = 32;
const POLICY_TAG_OFFSET = ALLOWLIST_ID_BYTES;
const NONCE_OFFSET = POLICY_TAG_OFFSET + 1;
const MIN_NONCE_BYTES = 1;

/** Structured view of an allowlist Seal identity. */
export interface AllowlistSealIdParts {
	readonly allowlistId: AllowlistId;
	readonly policyTag: SealPolicyTag;
	readonly nonce: Uint8Array;
}

/**
 * Build an allowlist-policy Seal identity. The nonce must be at least 1 byte
 * (the Move contract's `id.length() > 33` invariant); nonces of 16 random
 * bytes are typical.
 *
 * @throws {ValidationError} If `allowlistId` is not a 0x-prefixed 64-char
 *   hex string, or `nonce` is shorter than 1 byte.
 */
export function buildAllowlistSealId(
	allowlistId: AllowlistId,
	nonce: Uint8Array,
): SealId {
	if (nonce.length < MIN_NONCE_BYTES) {
		throw new ValidationError(
			`Seal nonce must be at least ${MIN_NONCE_BYTES} byte(s), got ${nonce.length}`,
			"nonce",
		);
	}
	const prefix = allowlistIdToBytes(allowlistId);
	const out = new Uint8Array(ALLOWLIST_ID_BYTES + 1 + nonce.length);
	out.set(prefix, 0);
	out[POLICY_TAG_OFFSET] = SealPolicyTag.Allowlist;
	out.set(nonce, NONCE_OFFSET);
	return out as SealId;
}

/**
 * Decode the structural fields of an allowlist Seal identity. The brand
 * guarantees the byte layout, so this never throws on a properly-built
 * identity. Throws `ValidationError` if the bytes carry a different policy
 * tag (e.g. publisher) — use `decodePublisherSealId` for those.
 */
export function decodeAllowlistSealId(id: SealId): AllowlistSealIdParts {
	const prefix = id.subarray(0, ALLOWLIST_ID_BYTES);
	const policyTagByte = id[POLICY_TAG_OFFSET] ?? 0;
	if (policyTagByte !== SealPolicyTag.Allowlist) {
		throw new ValidationError(
			`Seal identity has policy tag ${policyTagByte}, expected ${SealPolicyTag.Allowlist} (Allowlist). Use decodePublisherSealId for publisher-policy identities.`,
			"policyTag",
		);
	}
	const nonce = id.slice(NONCE_OFFSET);
	return {
		allowlistId: bytesToAllowlistId(prefix),
		policyTag: SealPolicyTag.Allowlist,
		nonce,
	};
}

function allowlistIdToBytes(value: AllowlistId): Uint8Array {
	const stripped = (value as string).startsWith("0x")
		? (value as string).slice(2)
		: (value as string);
	if (stripped.length > ALLOWLIST_ID_BYTES * 2) {
		throw new ValidationError(
			`AllowlistId exceeds ${ALLOWLIST_ID_BYTES} bytes`,
			"allowlistId",
		);
	}
	const padded = stripped.padStart(ALLOWLIST_ID_BYTES * 2, "0");
	if (!/^[0-9a-f]+$/i.test(padded)) {
		throw new ValidationError(
			`AllowlistId is not valid hex: ${value}`,
			"allowlistId",
		);
	}
	const out = new Uint8Array(ALLOWLIST_ID_BYTES);
	for (let i = 0; i < ALLOWLIST_ID_BYTES; i += 1) {
		out[i] = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function bytesToAllowlistId(bytes: Uint8Array): AllowlistId {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return `0x${hex}` as AllowlistId;
}
