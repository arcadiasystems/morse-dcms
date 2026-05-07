/**
 * Seal identity (`SealId`) construction and inspection. The Move layer
 * enforces the byte format on every encrypted revision and on the
 * `seal_approve_publisher` entry, so both encode and decode here must match
 * the contract byte-for-byte.
 *
 * Layout: `publication_id(32) || policy_tag(u8=1) || nonce(>=1)`. Total
 * length > 33 bytes (`ESealInvalidId` otherwise).
 */

import { ValidationError } from "../errors.js";
import { type PublicationId, type SealId, SealPolicyTag } from "../types.js";

const PUBLICATION_ID_BYTES = 32;
const POLICY_TAG_OFFSET = PUBLICATION_ID_BYTES;
const NONCE_OFFSET = POLICY_TAG_OFFSET + 1;
const MIN_NONCE_BYTES = 1;

/** Structured view of a publisher Seal identity. */
export interface SealIdParts {
	readonly publicationId: PublicationId;
	readonly policyTag: SealPolicyTag;
	readonly nonce: Uint8Array;
}

/**
 * Build a publisher-policy Seal identity for a publication. The nonce must
 * be at least 1 byte (the Move contract's `id.length() > 33` invariant);
 * nonces of 16 random bytes are typical.
 *
 * @throws {ValidationError} If `publicationId` is not a 0x-prefixed 64-char
 *   hex string, or `nonce` is shorter than 1 byte.
 */
export function buildPublisherSealId(
	publicationId: PublicationId,
	nonce: Uint8Array,
): SealId {
	if (nonce.length < MIN_NONCE_BYTES) {
		throw new ValidationError(
			`Seal nonce must be at least ${MIN_NONCE_BYTES} byte(s), got ${nonce.length}`,
			"nonce",
		);
	}
	const prefix = publicationIdToBytes(publicationId);
	const out = new Uint8Array(PUBLICATION_ID_BYTES + 1 + nonce.length);
	out.set(prefix, 0);
	out[POLICY_TAG_OFFSET] = SealPolicyTag.Publisher;
	out.set(nonce, NONCE_OFFSET);
	return out as SealId;
}

/**
 * Decode the structural fields of a Seal identity. The brand guarantees the
 * byte layout, so this never throws on a properly-built identity.
 */
export function decodePublisherSealId(id: SealId): SealIdParts {
	const prefix = id.subarray(0, PUBLICATION_ID_BYTES);
	const policyTagByte = id[POLICY_TAG_OFFSET] ?? 0;
	const nonce = id.slice(NONCE_OFFSET);
	return {
		publicationId: bytesToPublicationId(prefix),
		policyTag: policyTagToEnum(policyTagByte),
		nonce,
	};
}

function policyTagToEnum(byte: number): SealPolicyTag {
	if (byte === SealPolicyTag.Publisher) {
		return SealPolicyTag.Publisher;
	}
	throw new ValidationError(
		`Unknown Seal policy tag: ${byte} (only ${SealPolicyTag.Publisher} = Publisher is defined)`,
		"policyTag",
	);
}

function publicationIdToBytes(value: PublicationId): Uint8Array {
	const stripped = (value as string).startsWith("0x")
		? (value as string).slice(2)
		: (value as string);
	if (stripped.length > PUBLICATION_ID_BYTES * 2) {
		throw new ValidationError(
			`PublicationId exceeds ${PUBLICATION_ID_BYTES} bytes`,
			"publicationId",
		);
	}
	const padded = stripped.padStart(PUBLICATION_ID_BYTES * 2, "0");
	if (!/^[0-9a-f]+$/i.test(padded)) {
		throw new ValidationError(
			`PublicationId is not valid hex: ${value}`,
			"publicationId",
		);
	}
	const out = new Uint8Array(PUBLICATION_ID_BYTES);
	for (let i = 0; i < PUBLICATION_ID_BYTES; i += 1) {
		out[i] = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function bytesToPublicationId(bytes: Uint8Array): PublicationId {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return `0x${hex}` as PublicationId;
}
