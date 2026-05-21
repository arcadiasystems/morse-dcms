/**
 * High-level entry ops that compose Walrus upload + add_entry into 2 wallet
 * popups instead of 3.
 *
 * Background: a naive `uploadBlob` then `addEntry` flow emits three popups
 * (`register_blob`, `certify_blob`, `add_entry_to_collection`). The first
 * cannot be combined because the off-chain blob upload to storage nodes
 * happens between register and certify. The second and third are both
 * on-chain Sui transactions and can be packed into one PTB.
 *
 * `addEntryFromBytes` and `addEncryptedEntryFromBytes` use the
 * `WalrusFlowCapable.startBlobUpload` capability to drive the register
 * step, then append `add_entry_to_collection` to the certify `Transaction`
 * and submit once. The default `DefaultWalrusWriteAdapter` implements the
 * capability; consumers passing a custom `WalrusWriteAdapter` without
 * `WalrusFlowCapable` get a clear `TransportError` and should compose
 * `walrus.uploadBlob` + `addEntry` (3 popups) instead.
 */

import type { Transaction } from "@mysten/sui/transactions";

import type { MorsePackageConfig } from "../config.js";
import { TransportError, UncertifiedBlobError } from "../errors.js";
import { buildAddEncryptedEntry, buildAddEntry } from "../ptb/entry.js";
import type { SealAdapter } from "../seal/adapter.js";
import type {
	BlobObjectId,
	PublicationId,
	PublisherCapId,
	SealId,
	WalrusBlobId,
} from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import {
	isWalrusFlowCapable,
	type UploadBlobOptions,
	type WalrusFlowCapable,
	type WalrusWriteAdapter,
} from "../walrus/adapter.js";
import { decodeU64ReturnValue } from "./internal.js";

/**
 * Coarse-grained progress phases emitted by `addEntryFromBytes` and
 * `addEncryptedEntryFromBytes` for UI spinners and ETA hints.
 *
 * - `encrypting`: emitted once at the start of `addEncryptedEntryFromBytes`
 *   before the Seal call. Not emitted for the unencrypted variant.
 * - `uploading`: emitted before `register_blob` (popup 1) and again before
 *   the off-chain upload to storage nodes; UI can keep one spinner up
 *   across both.
 * - `submitting`: emitted before the combined `certify_blob + add_entry`
 *   PTB (popup 2).
 * - `complete`: emitted after the entry has been successfully added.
 *   Equivalent to the function's return; provided for symmetry so a single
 *   handler can cover the full lifecycle.
 */
export type ProgressEvent =
	| { readonly phase: "encrypting" }
	| { readonly phase: "uploading" }
	| { readonly phase: "submitting" }
	| { readonly phase: "complete" };

/** Optional callback shape for progress events. */
export type ProgressCallback = (event: ProgressEvent) => void;

/** Result of `addEntryFromBytes` / `addEncryptedEntryFromBytes`. */
export interface AddEntryFromBytesResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
	readonly entryId: number;
	/** Always `0` for the entry's first revision; surfaced for symmetry. */
	readonly revisionId: number;
	/** Sui object id of the newly-created `Blob` referenced by the entry. */
	readonly blobObjectId: BlobObjectId;
	/** Walrus content-addressed blob id (43-char URL-safe-base64). */
	readonly blobId: WalrusBlobId;
}

/** Args for `addEntryFromBytes`. */
export interface AddEntryFromBytesArgs {
	readonly walrus: WalrusWriteAdapter & WalrusFlowCapable;
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly collectionName: string;
	readonly name: string;
	readonly bytes: Uint8Array;
	readonly contentType: string;
	readonly upload: UploadBlobOptions;
	readonly signal?: AbortSignal;
	/**
	 * Optional callback invoked at coarse-grained phase boundaries:
	 * `uploading` before the register popup, `submitting` before the combined
	 * certify+addEntry popup, `complete` after the entry is added. Errors
	 * thrown by the callback are propagated.
	 */
	readonly onProgress?: ProgressCallback;
}

/**
 * Upload `bytes` to Walrus and add the resulting blob as a new entry in one
 * collection in 2 wallet popups: register_blob, then a combined
 * certify_blob + add_entry_to_collection PTB.
 *
 * @throws {UncertifiedBlobError} If the second popup fails after upload
 *   succeeded; the blob is uploaded but uncertified and storage is held
 *   until expiry. The original error is preserved as `cause`.
 * @throws {ContractAbortError} On Move abort during the simulation pass
 *   before any popup happens.
 * @throws {TransportError} On RPC, network, or upload-step failure before
 *   the blob is uploaded.
 */
export async function addEntryFromBytes(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: AddEntryFromBytesArgs,
): Promise<AddEntryFromBytesResult> {
	assertFlowCapable(args.walrus);
	args.onProgress?.({ phase: "uploading" });
	const upload = await args.walrus.startBlobUpload(args.bytes, args.upload);

	try {
		const tx = upload.certifyTransaction;
		buildAddEntry(tx, {
			packageId: config.packageId,
			publication: args.publicationId,
			publisherCap: args.publisherCapId,
			collectionName: args.collectionName,
			name: args.name,
			blobObjectId: upload.blobObjectId,
			contentType: args.contentType,
		});
		args.onProgress?.({ phase: "submitting" });
		const result = await submitCombinedTx(adapter, tx, {
			blobObjectId: upload.blobObjectId,
			blobId: upload.blobId,
			...(args.signal === undefined ? {} : { signal: args.signal }),
		});
		args.onProgress?.({ phase: "complete" });
		return result;
	} catch (cause) {
		if (cause instanceof UncertifiedBlobError) throw cause;
		throw new UncertifiedBlobError(upload.blobObjectId, upload.blobId, {
			cause,
		});
	}
}

/** Args for `addEncryptedEntryFromBytes`. */
export interface AddEncryptedEntryFromBytesArgs {
	readonly walrus: WalrusWriteAdapter & WalrusFlowCapable;
	readonly seal: SealAdapter;
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly collectionName: string;
	readonly name: string;
	readonly plaintext: Uint8Array;
	readonly contentType: string;
	readonly sealId: SealId;
	readonly upload: UploadBlobOptions;
	readonly signal?: AbortSignal;
	/**
	 * Optional callback invoked at coarse-grained phase boundaries:
	 * `encrypting` (Seal call), `uploading` (register + off-chain upload),
	 * `submitting` (combined certify+addEntry popup), `complete`. Errors
	 * thrown by the callback are propagated.
	 */
	readonly onProgress?: ProgressCallback;
}

/**
 * Encrypt `plaintext` via Seal, upload the ciphertext to Walrus, and add the
 * resulting blob as a new encrypted entry in 2 wallet popups (encryption is
 * popup-free; popups are register_blob then certify_blob + add_entry).
 *
 * @throws {SealError} If encryption fails (no popup yet).
 * @throws {UncertifiedBlobError} If the second popup fails after upload
 *   succeeded.
 * @throws {ContractAbortError} On Move abort during simulation.
 * @throws {TransportError} On RPC, network, or upload-step failure before
 *   the blob is uploaded.
 */
export async function addEncryptedEntryFromBytes(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: AddEncryptedEntryFromBytesArgs,
): Promise<AddEntryFromBytesResult> {
	assertFlowCapable(args.walrus);

	args.onProgress?.({ phase: "encrypting" });
	const { ciphertext } = await args.seal.encrypt(args.plaintext, {
		sealId: args.sealId,
	});

	args.onProgress?.({ phase: "uploading" });
	const upload = await args.walrus.startBlobUpload(ciphertext, args.upload);

	try {
		const tx = upload.certifyTransaction;
		buildAddEncryptedEntry(tx, {
			packageId: config.packageId,
			publication: args.publicationId,
			publisherCap: args.publisherCapId,
			collectionName: args.collectionName,
			name: args.name,
			blobObjectId: upload.blobObjectId,
			contentType: args.contentType,
			sealId: args.sealId,
		});
		args.onProgress?.({ phase: "submitting" });
		const result = await submitCombinedTx(adapter, tx, {
			blobObjectId: upload.blobObjectId,
			blobId: upload.blobId,
			...(args.signal === undefined ? {} : { signal: args.signal }),
		});
		args.onProgress?.({ phase: "complete" });
		return result;
	} catch (cause) {
		if (cause instanceof UncertifiedBlobError) throw cause;
		throw new UncertifiedBlobError(upload.blobObjectId, upload.blobId, {
			cause,
		});
	}
}

function assertFlowCapable(
	walrus: WalrusWriteAdapter,
): asserts walrus is WalrusWriteAdapter & WalrusFlowCapable {
	if (!isWalrusFlowCapable(walrus)) {
		throw new TransportError(
			"addEntryFromBytes / addEncryptedEntryFromBytes require a WalrusWriteAdapter that implements WalrusFlowCapable (i.e. exposes startBlobUpload). The default DefaultWalrusWriteAdapter does. Custom adapters that do not implement the capability should compose walrus.uploadBlob + addEntry (3 popups) instead.",
			{ operation: "sdk.addEntryFromBytes" },
		);
	}
}

interface SubmitCombinedArgs {
	readonly blobObjectId: BlobObjectId;
	readonly blobId: WalrusBlobId;
	readonly signal?: AbortSignal;
}

async function submitCombinedTx(
	adapter: WalletAdapter,
	tx: Transaction,
	args: SubmitCombinedArgs,
): Promise<AddEntryFromBytesResult> {
	const simulated = await adapter.simulateTransaction(tx, args.signal);
	// Combined PTB: certify_blob is move call 0, add_entry_to_collection is
	// move call 1; the entryId u64 is the return value of call 1.
	const entryId = decodeU64ReturnValue(simulated, 1, 0);
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		entryId,
		revisionId: 0,
		blobObjectId: args.blobObjectId,
		blobId: args.blobId,
	};
}
