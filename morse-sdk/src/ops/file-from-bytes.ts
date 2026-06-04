/**
 * High-level "upload + register" flows for the file module. Combines Walrus
 * upload with on-chain metadata registration in a single PTB so the user
 * sees one signing popup for the storage step plus one for the on-chain
 * write (rather than three separate popups).
 *
 * Mirrors `entry-from-bytes.ts`'s shape but targets `file::new_encrypted_file`
 * / `file::new_public_file` instead of `add_entry_to_collection`.
 */

import type { TransactionObjectArgument } from "@mysten/sui/transactions";

import { toEncryptedFileId } from "../codecs.js";
import type { MorsePackageConfig } from "../config.js";
import { TransportError, UncertifiedBlobError } from "../errors.js";
import {
	buildNewEncryptedFile,
	buildNewPublicFile,
	buildShareFile,
} from "../ptb/file.js";
import type { SealAdapter } from "../seal/adapter.js";
import type {
	AllowlistId,
	BlobObjectId,
	EncryptedFileId,
	SealId,
	WalrusBlobId,
} from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import type {
	UploadBlobOptions,
	WalrusFlowCapable,
	WalrusWriteAdapter,
} from "../walrus/adapter.js";
import { isWalrusFlowCapable } from "../walrus/adapter.js";
import { findCreatedId } from "./internal.js";

export type FileUploadProgressEvent =
	| { readonly phase: "encrypting" }
	| { readonly phase: "uploading" }
	| { readonly phase: "submitting" }
	| { readonly phase: "complete" };

export type FileUploadProgressCallback = (
	event: FileUploadProgressEvent,
) => void;

export interface UploadFileResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
	readonly fileId: EncryptedFileId;
	readonly blobId: WalrusBlobId;
	readonly blobObjectId: BlobObjectId;
}

// Encrypted

export interface UploadEncryptedFileFromBytesArgs {
	readonly walrus: WalrusWriteAdapter & WalrusFlowCapable;
	readonly seal: SealAdapter;
	readonly allowlistId: AllowlistId;
	/** Caller-supplied Seal identity. Must derive from `buildAllowlistSealId(allowlistId, nonce)`. */
	readonly sealId: SealId;
	readonly plaintext: Uint8Array;
	readonly name: string;
	readonly contentType: string;
	readonly upload: UploadBlobOptions;
	readonly signal?: AbortSignal;
	readonly onProgress?: FileUploadProgressCallback;
}

/**
 * Encrypt `plaintext` via Seal under the allowlist's identity, upload the
 * ciphertext to Walrus, and register an `EncryptedFile` metadata record in
 * one combined transaction. Two wallet popups: register_blob, then
 * certify_blob + new_encrypted_file + share_file.
 *
 * The caller supplies `sealId` rather than having the flow construct it,
 * so the decryption side can use the same identity bytes without an
 * implicit shared-secret round-trip. Build via:
 *
 *   const nonce = crypto.getRandomValues(new Uint8Array(16));
 *   const sealId = buildAllowlistSealId(allowlistId, nonce);
 *
 * Reuse the same nonce-derived sealId when decrypting (consumers can
 * recover it by reading the encrypted ciphertext header — Seal stores the
 * identity in the ciphertext envelope).
 *
 * @throws {SealError} If encryption fails (no popup yet).
 * @throws {UncertifiedBlobError} If the combined popup fails after upload
 *   succeeded. The blob is on Walrus but uncertified; retry the full flow.
 * @throws {ContractAbortError} On Move abort during simulation.
 * @throws {TransportError} On RPC, network, or pre-upload failure.
 */
export async function uploadEncryptedFileFromBytes(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: UploadEncryptedFileFromBytesArgs,
): Promise<UploadFileResult> {
	assertFlowCapable(args.walrus);

	args.onProgress?.({ phase: "encrypting" });
	const { ciphertext } = await args.seal.encrypt(args.plaintext, {
		sealId: args.sealId,
	});

	args.onProgress?.({ phase: "uploading" });
	const upload = await args.walrus.startBlobUpload(ciphertext, args.upload);

	try {
		const tx = upload.certifyTransaction;
		const created = buildNewEncryptedFile(tx, {
			packageId: config.packageId,
			blobId: upload.blobId,
			blobObjectId: upload.blobObjectId,
			name: args.name,
			contentType: args.contentType,
			size: BigInt(args.plaintext.length),
			allowlistId: args.allowlistId,
		});
		buildShareFile(tx, {
			packageId: config.packageId,
			file: created as unknown as TransactionObjectArgument,
		});

		args.onProgress?.({ phase: "submitting" });
		const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
		// See ops/allowlist.ts: file::EncryptedFile was introduced in v2.
		const typePrefix = config.packageId;
		const fileId = toEncryptedFileId(
			findCreatedId(receipt, `${typePrefix}::file::EncryptedFile`),
		);

		args.onProgress?.({ phase: "complete" });
		return {
			digest: receipt.digest,
			gasUsedMist: receipt.gasUsedMist,
			fileId,
			blobId: upload.blobId,
			blobObjectId: upload.blobObjectId,
		};
	} catch (cause) {
		if (cause instanceof UncertifiedBlobError) throw cause;
		throw new UncertifiedBlobError(upload.blobObjectId, upload.blobId, {
			cause,
		});
	}
}

// Public (unencrypted)

export interface UploadPublicFileFromBytesArgs {
	readonly walrus: WalrusWriteAdapter & WalrusFlowCapable;
	readonly bytes: Uint8Array;
	readonly name: string;
	readonly contentType: string;
	readonly upload: UploadBlobOptions;
	readonly signal?: AbortSignal;
	readonly onProgress?: FileUploadProgressCallback;
}

/**
 * Upload `bytes` to Walrus unencrypted and register a public `EncryptedFile`
 * metadata record (`encrypted: false`, `allowlistId: null`) in one combined
 * transaction. Two wallet popups; no Seal involvement.
 */
export async function uploadPublicFileFromBytes(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: UploadPublicFileFromBytesArgs,
): Promise<UploadFileResult> {
	assertFlowCapable(args.walrus);

	args.onProgress?.({ phase: "uploading" });
	const upload = await args.walrus.startBlobUpload(args.bytes, args.upload);

	try {
		const tx = upload.certifyTransaction;
		const created = buildNewPublicFile(tx, {
			packageId: config.packageId,
			blobId: upload.blobId,
			blobObjectId: upload.blobObjectId,
			name: args.name,
			contentType: args.contentType,
			size: BigInt(args.bytes.length),
		});
		buildShareFile(tx, {
			packageId: config.packageId,
			file: created as unknown as TransactionObjectArgument,
		});

		args.onProgress?.({ phase: "submitting" });
		const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
		// See ops/allowlist.ts: file::EncryptedFile was introduced in v2.
		const typePrefix = config.packageId;
		const fileId = toEncryptedFileId(
			findCreatedId(receipt, `${typePrefix}::file::EncryptedFile`),
		);

		args.onProgress?.({ phase: "complete" });
		return {
			digest: receipt.digest,
			gasUsedMist: receipt.gasUsedMist,
			fileId,
			blobId: upload.blobId,
			blobObjectId: upload.blobObjectId,
		};
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
			"uploadEncryptedFileFromBytes / uploadPublicFileFromBytes require a WalrusWriteAdapter that implements WalrusFlowCapable (i.e. exposes startBlobUpload). The default DefaultWalrusWriteAdapter does. Custom adapters that do not implement the capability should compose walrus.uploadBlob + create_*_file (3 popups) instead.",
			{ operation: "sdk.uploadFileFromBytes" },
		);
	}
}
