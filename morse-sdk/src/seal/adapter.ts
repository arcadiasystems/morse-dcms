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
	encrypt(
		plaintext: Uint8Array,
		options: SealEncryptOptions,
	): Promise<SealEncryptResult>;
	/**
	 * @throws {ValidationError} If `sealId` carries an unknown policy tag (the
	 *   `decodePublisherSealId` step inside the adapter rejects tampered IDs).
	 * @throws {SealError} On Seal authorization or decryption failure.
	 * @throws {TransportError} On network or PTB build failure.
	 */
	decrypt(
		ciphertext: Uint8Array,
		options: SealDecryptOptions,
	): Promise<Uint8Array>;
}
