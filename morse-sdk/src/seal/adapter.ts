/**
 * Seal adapter interface: encrypt content under a publisher Seal identity
 * and decrypt with a consumer-supplied `SessionKey`. Configuration
 * (key servers, threshold, package id) is bound at construction time.
 */

import type { SessionKey } from "@mysten/seal";

import type { PublisherCapId, SealId } from "../types.js";

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
}
