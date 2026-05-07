/**
 * Seal subpackage barrel: identity construction, the adapter interface, and
 * the default adapter wrapping `@mysten/seal`.
 */

export type {
	SealAdapter,
	SealDecryptOptions,
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
