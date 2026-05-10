/**
 * Write-only Walrus adapter interface. Reads are deferred to entry-fetch in
 * a later phase; this surface intentionally exposes only what entry-write
 * paths need.
 */

import type { Transaction } from "@mysten/sui/transactions";

import type { BlobObjectId, QuiltPatchId, WalrusBlobId } from "../types.js";

/** Storage parameters shared by blob and quilt uploads. */
export interface WalrusUploadCommonOptions {
	/** Number of Walrus epochs the blob should be stored for. */
	readonly epochs: number;
	/** Whether the resulting blob object is deletable. The Move layer rejects non-deletable blobs. */
	readonly deletable: boolean;
	/** Address that will own the resulting Sui blob object; defaults to the signer. */
	readonly owner?: string;
	/** Cancellation signal forwarded to the underlying network layer. */
	readonly signal?: AbortSignal;
}

/** Options for `uploadBlob`. */
export type UploadBlobOptions = WalrusUploadCommonOptions;

/** One blob to include in a quilt upload. */
export interface QuiltPatchInput {
	/** Bytes for this patch. */
	readonly contents: Uint8Array;
	/** Identifier unique within the quilt; surfaced back in `UploadQuiltResult.patches[].identifier`. */
	readonly identifier: string;
	/** Optional key-value tags attached to the patch. */
	readonly tags?: Readonly<Record<string, string>>;
}

/** Options for `uploadQuilt`. */
export type UploadQuiltOptions = WalrusUploadCommonOptions;

/** Result of `uploadBlob`. */
export interface UploadBlobResult {
	readonly blobId: WalrusBlobId;
	readonly blobObjectId: BlobObjectId;
}

/** One patch in `UploadQuiltResult`. */
export interface UploadQuiltPatch {
	readonly identifier: string;
	readonly patchId: QuiltPatchId;
	readonly startIndex: number;
	readonly endIndex: number;
}

/** Result of `uploadQuilt`. */
export interface UploadQuiltResult {
	readonly blobId: WalrusBlobId;
	readonly blobObjectId: BlobObjectId;
	readonly patches: readonly UploadQuiltPatch[];
}

/**
 * Write-only Walrus client. Implementations: `DefaultWalrusWriteAdapter`
 * (wraps `@mysten/walrus`); user-supplied adapters can substitute for tests
 * or alternative storage backends. Errors at the boundary normalize to
 * `TransportError` (network, IO) or `ValidationError` (malformed input).
 */
export interface WalrusWriteAdapter {
	uploadBlob(
		data: Uint8Array,
		options: UploadBlobOptions,
	): Promise<UploadBlobResult>;
	uploadQuilt(
		patches: readonly QuiltPatchInput[],
		options: UploadQuiltOptions,
	): Promise<UploadQuiltResult>;
}

/** Result of `WalrusFlowCapable.startBlobUpload`. */
export interface StartBlobUploadResult {
	readonly blobObjectId: BlobObjectId;
	readonly blobId: WalrusBlobId;
	/**
	 * `Transaction` already containing the `walrus::blob::certify_blob` move
	 * call. Append your downstream calls (e.g. `add_entry_to_collection`) and
	 * submit the same `Transaction`.
	 */
	readonly certifyTransaction: Transaction;
}

/**
 * Optional capability layered on top of `WalrusWriteAdapter`. Adapters that
 * support driving Walrus's `writeBlobFlow` step-by-step can implement this
 * to enable single-PTB ops like `addEntryFromBytes` / `addEncryptedEntryFromBytes`,
 * which combine `certify_blob` with downstream contract calls in one wallet
 * popup. Adapters without this capability fall back to the standard 2- or
 * 3-popup paths via `uploadBlob` + downstream ops.
 */
export interface WalrusFlowCapable {
	/**
	 * Register and upload a blob without certifying it on-chain. Returns
	 * the blob's Sui object id, content id, and the certify `Transaction`.
	 * The caller appends further move calls to `certifyTransaction` and
	 * submits once, combining certify + downstream ops into a single
	 * wallet popup.
	 */
	startBlobUpload(
		data: Uint8Array,
		options: UploadBlobOptions,
	): Promise<StartBlobUploadResult>;
}

/** Type guard for the optional flow capability. */
export function isWalrusFlowCapable(
	walrus: WalrusWriteAdapter,
): walrus is WalrusWriteAdapter & WalrusFlowCapable {
	return (
		typeof (walrus as WalrusWriteAdapter & Partial<WalrusFlowCapable>)
			.startBlobUpload === "function"
	);
}
