/**
 * Seal subpackage barrel: identity construction, the adapter interface, and
 * the default adapter wrapping `@mysten/seal`.
 */

export type {
	SealAdapter,
	SealDecryptOptions,
	SealDecryptUnderAllowlistOptions,
	SealEncryptOptions,
	SealEncryptResult,
} from "./adapter.js";
export {
	type AllowlistSealIdParts,
	buildAllowlistSealId,
	decodeAllowlistSealId,
} from "./allowlist-identity.js";
export {
	DefaultSealAdapter,
	type SealAdapterConfig,
} from "./default-adapter.js";
export {
	buildPublisherSealId,
	decodePublisherSealId,
	type SealIdParts,
} from "./identity.js";
