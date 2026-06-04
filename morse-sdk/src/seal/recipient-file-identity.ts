/**
 * Seal identity (`SealId`) construction and inspection for the recipient-file
 * policy. The Move layer (`recipient_file::seal_approve_with_prefix`) enforces
 * the byte format against a caller-supplied prefix stored on the file as a
 * dynamic field, so the prefix bytes used at encrypt time and the bytes
 * bound on chain at file creation must match exactly.
 *
 * Layout: `seal_id_prefix(>=1) || policy_tag(u8=3) || nonce(>=1)`. Both the
 * prefix and the nonce must be at least 1 byte (Move contract's
 * `id.length() > prefix_len + 1` invariant); 32 random prefix bytes + 16
 * random nonce bytes is the recommended default.
 *
 * The prefix is no longer derived from the file's Sui object id (that scheme
 * required knowing the id before signing the transaction that creates it, an
 * impossible ordering for single-PTB encrypted upload). Callers pick a fresh
 * random prefix per file; the file is created with the prefix attached.
 */

import { ValidationError } from "../errors.js";
import { type SealId, SealPolicyTag } from "../types.js";

const POLICY_TAG_BYTES = 1;
const MIN_PREFIX_BYTES = 1;
const MIN_NONCE_BYTES = 1;
/** Recommended prefix length: 32 random bytes. Long enough to collision-avoid across files. */
export const RECOMMENDED_SEAL_PREFIX_BYTES = 32;
/** Recommended nonce length: 16 random bytes. Distinct envelopes per encrypt. */
export const RECOMMENDED_SEAL_NONCE_BYTES = 16;

/** Structured view of a recipient-file Seal identity built around a custom prefix. */
export interface RecipientFileSealIdParts {
	readonly prefix: Uint8Array;
	readonly policyTag: SealPolicyTag;
	readonly nonce: Uint8Array;
}

/**
 * Build a recipient-file Seal identity. The prefix is the bytes the on-chain
 * file must carry (attached via `new_recipient_file_with_seal_prefix`); the
 * nonce is per-encryption.
 *
 * @throws {ValidationError} If `prefix` or `nonce` is empty.
 */
export function buildRecipientFileSealId(
	prefix: Uint8Array,
	nonce: Uint8Array,
): SealId {
	if (prefix.length < MIN_PREFIX_BYTES) {
		throw new ValidationError(
			`Seal prefix must be at least ${MIN_PREFIX_BYTES} byte(s), got ${prefix.length}`,
			"prefix",
		);
	}
	if (nonce.length < MIN_NONCE_BYTES) {
		throw new ValidationError(
			`Seal nonce must be at least ${MIN_NONCE_BYTES} byte(s), got ${nonce.length}`,
			"nonce",
		);
	}
	const out = new Uint8Array(prefix.length + POLICY_TAG_BYTES + nonce.length);
	out.set(prefix, 0);
	out[prefix.length] = SealPolicyTag.RecipientFile;
	out.set(nonce, prefix.length + POLICY_TAG_BYTES);
	return out as SealId;
}

/**
 * Decode a recipient-file Seal identity into prefix + tag + nonce. Requires
 * the caller to provide `prefixLength` because the layout is not
 * self-delimiting (the prefix is arbitrary-length). Throws `ValidationError`
 * if the bytes carry a different policy tag or the length is insufficient.
 */
export function decodeRecipientFileSealId(
	id: SealId,
	prefixLength: number,
): RecipientFileSealIdParts {
	if (prefixLength < MIN_PREFIX_BYTES) {
		throw new ValidationError(
			`prefixLength must be at least ${MIN_PREFIX_BYTES}, got ${prefixLength}`,
			"prefixLength",
		);
	}
	if (id.length < prefixLength + POLICY_TAG_BYTES + MIN_NONCE_BYTES) {
		throw new ValidationError(
			`Seal identity is shorter than prefix(${prefixLength}) + tag(1) + nonce(>=1)`,
			"id",
		);
	}
	const tagByte = id[prefixLength] ?? 0;
	if (tagByte !== SealPolicyTag.RecipientFile) {
		throw new ValidationError(
			`Seal identity has policy tag ${tagByte}, expected ${SealPolicyTag.RecipientFile} (RecipientFile). Use decodePublisherSealId for publisher-policy identities.`,
			"policyTag",
		);
	}
	return {
		prefix: id.slice(0, prefixLength),
		policyTag: SealPolicyTag.RecipientFile,
		nonce: id.slice(prefixLength + POLICY_TAG_BYTES),
	};
}

/**
 * Convenience: 32 random bytes suitable for `buildRecipientFileSealId`'s
 * `prefix` argument. Uses Web Crypto; throws on environments without
 * `crypto.getRandomValues`. The same value must be passed to
 * `new_recipient_file_with_seal_prefix` so the on-chain prefix matches.
 */
export function randomSealPrefix(): Uint8Array {
	const bytes = new Uint8Array(RECOMMENDED_SEAL_PREFIX_BYTES);
	crypto.getRandomValues(bytes);
	return bytes;
}

/** Convenience: 16 random bytes suitable for `buildRecipientFileSealId`'s `nonce` argument. */
export function randomSealNonce(): Uint8Array {
	const bytes = new Uint8Array(RECOMMENDED_SEAL_NONCE_BYTES);
	crypto.getRandomValues(bytes);
	return bytes;
}
