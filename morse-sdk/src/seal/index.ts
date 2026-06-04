/**
 * Seal subpackage barrel: identity construction, the adapter interface, and
 * the default adapter wrapping `@mysten/seal`.
 */

export type {
	SealAdapter,
	SealDecryptOptions,
	SealDecryptUnderRecipientFileOptions,
	SealEncryptOptions,
	SealEncryptResult,
} from "./adapter.js";
export {
	DefaultSealAdapter,
	type SealAdapterConfig,
} from "./default-adapter.js";
export {
	buildPublisherSealId,
	decodePublisherSealId,
	type SealIdParts,
} from "./identity.js";
export {
	buildRecipientFileSealId,
	decodeRecipientFileSealId,
	RECOMMENDED_SEAL_NONCE_BYTES,
	RECOMMENDED_SEAL_PREFIX_BYTES,
	type RecipientFileSealIdParts,
	randomSealNonce,
	randomSealPrefix,
} from "./recipient-file-identity.js";
