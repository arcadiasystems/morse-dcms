/**
 * Seal adapter interface: encrypt content under a publisher Seal identity
 * and decrypt with a consumer-supplied `SessionKey`. Configuration
 * (key servers, threshold, package id) is bound at construction time.
 */

import type { SessionKey } from "@mysten/seal";

import type { AllowlistId, PublisherCapId, SealId } from "../types.js";

export interface SealEncryptOptions {
	readonly sealId: SealId;
	/** Optional additional authenticated data bound into the ciphertext. */
	readonly aad?: Uint8Array;
}

export interface SealEncryptResult {
	readonly ciphertext: Uint8Array;
}

export interface SealDecryptOptions {
	/**
	 * Session key constructed by the consumer's wallet (out-of-band: requires
	 * a signed personal message). The SDK never builds session keys silently.
	 */
	readonly sessionKey: SessionKey;
	readonly sealId: SealId;
	readonly publisherCapId: PublisherCapId;
}

/** Options for decrypting content gated by the allowlist policy. */
export interface SealDecryptUnderAllowlistOptions {
	readonly sessionKey: SessionKey;
	readonly sealId: SealId;
	readonly allowlistId: AllowlistId;
}

/**
 * Combined Seal adapter. Implementations bundle a `SealClient`, the morse
 * package id (Seal binds it into ciphertext envelopes), and a TSS threshold.
 * Errors normalize to `SealError` (content/authorization failures) or
 * `TransportError` (network).
 */
export interface SealAdapter {
	/**
	 * Encrypt `plaintext` under the supplied Seal identity. The ciphertext
	 * envelope binds the morse package id and the TSS threshold; decrypting
	 * later requires the same key-server set and threshold the adapter was
	 * constructed with.
	 *
	 * @throws {SealError} On Seal-side encryption failure (rare).
	 * @throws {TransportError} On network failure.
	 */
	encrypt(
		plaintext: Uint8Array,
		options: SealEncryptOptions,
	): Promise<SealEncryptResult>;
	/**
	 * Decrypt `ciphertext` produced by an earlier `encrypt` call. The Seal
	 * key servers verify that `publisherCapId` is active (not in the
	 * publication's revoked denylist) before issuing decryption material;
	 * a revoked cap surfaces as `SealError("no-access")`.
	 *
	 * @throws {SealError} On Seal authorization failure (`no-access`),
	 *   decryption failure (`decrypt-failed` — also raised when `sealId` is
	 *   malformed), session-key expiry (`session-expired`), or rate
	 *   limiting (`rate-limited`).
	 * @throws {TransportError} On network or PTB build failure.
	 */
	decrypt(
		ciphertext: Uint8Array,
		options: SealDecryptOptions,
	): Promise<Uint8Array>;
	/**
	 * Decrypt content gated by the allowlist policy. The Seal key servers
	 * verify that `sessionKey.getAddress()` is a current member of `allowlistId`
	 * by dry-running `allowlist::seal_approve(sealId, allowlist)`; non-members
	 * surface as `SealError("no-access")`.
	 *
	 * Distinct from `decrypt`, which targets the publisher policy. Both can
	 * coexist on the same adapter instance since policy targeting is decided
	 * by the seal_approve PTB the adapter constructs internally.
	 *
	 * @throws {SealError} On Seal authorization failure (`no-access`),
	 *   decryption failure (`decrypt-failed`), session-key expiry, or rate limiting.
	 * @throws {TransportError} On network or PTB build failure.
	 */
	decryptUnderAllowlist(
		ciphertext: Uint8Array,
		options: SealDecryptUnderAllowlistOptions,
	): Promise<Uint8Array>;
}
