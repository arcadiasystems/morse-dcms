/**
 * Walrus subpackage barrel: write adapter interface, default impl, and the
 * QuiltPatchId structural codec.
 */

export type {
	QuiltPatchInput,
	UploadBlobOptions,
	UploadBlobResult,
	UploadQuiltOptions,
	UploadQuiltPatch,
	UploadQuiltResult,
	WalrusUploadCommonOptions,
	WalrusWriteAdapter,
} from "./adapter.js";
export {
	DefaultWalrusWriteAdapter,
	type DefaultWalrusWriteAdapterOptions,
	type WalrusAdapterConfig,
} from "./default-adapter.js";
export {
	decodeQuiltPatchId,
	encodeQuiltPatchId,
	type QuiltPatchIdParts,
	quiltPatchIdFromString,
	quiltPatchIdToString,
} from "./quilt-patch-id.js";
