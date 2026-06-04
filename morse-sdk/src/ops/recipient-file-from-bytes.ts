/**
 * One-shot upload helpers that combine Walrus blob upload with
 * RecipientFile creation in 2 wallet popups.
 *
 * Background: a naive flow has three popups (Walrus `register_blob`, Walrus
 * `certify_blob`, then `new_recipient_file_with_seal_prefix`). The second
 * and third are both on-chain Sui transactions and can be packed into one
 * PTB. The first cannot be merged because the off-chain byte upload to
 * storage nodes happens between register and certify.
 *
 * The encrypted variant exploits the v4 contract's caller-supplied seal
 * prefix: the client picks a random prefix, encrypts under it before
 * uploading, and binds the same prefix on chain via
 * `new_recipient_file_with_seal_prefix`. This breaks the file-id chicken-
 * and-egg the v3 contract had (file id was unknown at encrypt time).
 */

import type { Transaction } from "@mysten/sui/transactions";

import { toRecipientFileId } from "../codecs.js";
import type { MorsePackageConfig } from "../config.js";
import { TransportError, UncertifiedBlobError } from "../errors.js";
import {
	buildNewRecipientFile,
	buildNewRecipientFileWithSealPrefix,
	buildShareRecipientFile,
} from "../ptb/recipient-file.js";
import type { SealAdapter } from "../seal/adapter.js";
import {
	buildRecipientFileSealId,
	randomSealNonce,
	randomSealPrefix,
} from "../seal/recipient-file-identity.js";
import type {
	BlobObjectId,
	RecipientFileId,
	SuiAddress,
	WalrusBlobId,
} from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import {
	isWalrusFlowCapable,
	type UploadBlobOptions,
	type WalrusFlowCapable,
	type WalrusWriteAdapter,
} from "../walrus/adapter.js";
import { findCreatedId } from "./internal.js";

/**
 * Coarse-grained progress phases.
 *
 * - `encrypting`: emitted once at the start of
 *   `uploadEncryptedRecipientFileFromBytes` before the Seal call. Not
 *   emitted for the public variant.
 * - `uploading`: emitted before `register_blob` (popup 1) and again before
 *   the off-chain upload to storage nodes; UI can keep one spinner across
 *   both.
 * - `submitting`: emitted before the combined `certify_blob +
 *   new_recipient_file{_with_seal_prefix} + share` PTB (popup 2).
 * - `complete`: emitted after the file has been created on chain.
 */
export type FileUploadProgressEvent =
	| { readonly phase: "encrypting" }
	| { readonly phase: "uploading" }
	| { readonly phase: "submitting" }
	| { readonly phase: "complete" };

export type FileUploadProgressCallback = (
	event: FileUploadProgressEvent,
) => void;

/** Result of `uploadRecipientFileFromBytes` / `uploadEncryptedRecipientFileFromBytes`. */
export interface UploadRecipientFileResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
	readonly fileId: RecipientFileId;
	readonly blobId: WalrusBlobId;
	readonly blobObjectId: BlobObjectId;
}

/** Args for `uploadRecipientFileFromBytes`. */
export interface UploadRecipientFileArgs {
	readonly walrus: WalrusWriteAdapter & WalrusFlowCapable;
	readonly bytes: Uint8Array;
	readonly recipients: readonly SuiAddress[];
	readonly name: string;
	readonly contentType: string;
	readonly upload: UploadBlobOptions;
	readonly signal?: AbortSignal;
	readonly onProgress?: FileUploadProgressCallback;
}

/**
 * Upload `bytes` to Walrus and create a public (unencrypted) `RecipientFile`
 * in 2 wallet popups: `register_blob`, then a combined `certify_blob +
 * new_recipient_file + share` PTB.
 *
 * @throws {UncertifiedBlobError} If popup 2 fails after upload succeeded.
 *   The blob is uploaded but uncertified and storage is held until expiry.
 * @throws {ContractAbortError} On Move abort during simulation.
 * @throws {TransportError} On RPC, network, or upload-step failure.
 */
export async function uploadRecipientFileFromBytes(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: UploadRecipientFileArgs,
): Promise<UploadRecipientFileResult> {
	assertFlowCapable(args.walrus);

	args.onProgress?.({ phase: "uploading" });
	const upload = await args.walrus.startBlobUpload(args.bytes, args.upload);

	try {
		const tx = upload.certifyTransaction;
		const file = buildNewRecipientFile(tx, {
			packageId: config.packageId,
			blobId: upload.blobId,
			blobObjectId: upload.blobObjectId,
			name: args.name,
			contentType: args.contentType,
			size: args.bytes.length,
			recipients: args.recipients,
		});
		buildShareRecipientFile(tx, { packageId: config.packageId, file });

		args.onProgress?.({ phase: "submitting" });
		const result = await submitCombinedTx(adapter, tx, config, {
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

/** Args for `uploadEncryptedRecipientFileFromBytes`. */
export interface UploadEncryptedRecipientFileArgs {
	readonly walrus: WalrusWriteAdapter & WalrusFlowCapable;
	readonly seal: SealAdapter;
	readonly plaintext: Uint8Array;
	readonly recipients: readonly SuiAddress[];
	readonly name: string;
	readonly contentType: string;
	readonly upload: UploadBlobOptions;
	readonly signal?: AbortSignal;
	readonly onProgress?: FileUploadProgressCallback;
	/**
	 * Optional caller-supplied seal prefix. Defaults to 32 random bytes from
	 * Web Crypto. Override for deterministic tests or when the prefix is
	 * derived from external state. Must be at least 1 byte.
	 */
	readonly sealIdPrefix?: Uint8Array;
	/**
	 * Optional caller-supplied seal nonce. Defaults to 16 random bytes from
	 * Web Crypto. Override for deterministic tests; must be at least 1 byte.
	 */
	readonly sealNonce?: Uint8Array;
}

/** Result of `uploadEncryptedRecipientFileFromBytes`. */
export interface UploadEncryptedRecipientFileResult
	extends UploadRecipientFileResult {
	/** The seal prefix bound to the on-chain file. Recipients need this to decrypt. */
	readonly sealIdPrefix: Uint8Array;
	/** The nonce used for this encryption. Surface to indexers/UI as needed. */
	readonly sealNonce: Uint8Array;
}

/**
 * Encrypt `plaintext` under Seal with a caller-supplied prefix, upload the
 * ciphertext to Walrus, and create an encrypted `RecipientFile` carrying
 * the prefix on chain. 2 wallet popups: `register_blob`, then a combined
 * `certify_blob + new_recipient_file_with_seal_prefix + share` PTB.
 *
 * After this returns, recipients can decrypt by reading the file, fetching
 * the blob via Walrus, and calling
 * `sealAdapter.decryptUnderRecipientFile(ciphertext, { fileId, sealId, sessionKey })`
 * where `sealId = sealIdPrefix || tag(=3) || sealNonce` (rebuild via
 * `buildRecipientFileSealId(sealIdPrefix, sealNonce)`).
 *
 * @throws {SealError} If encryption fails (no popup yet).
 * @throws {UncertifiedBlobError} If popup 2 fails after upload succeeded.
 * @throws {ContractAbortError} On Move abort during simulation.
 * @throws {TransportError} On RPC, network, or upload-step failure.
 */
export async function uploadEncryptedRecipientFileFromBytes(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: UploadEncryptedRecipientFileArgs,
): Promise<UploadEncryptedRecipientFileResult> {
	assertFlowCapable(args.walrus);

	const sealIdPrefix = args.sealIdPrefix ?? randomSealPrefix();
	const sealNonce = args.sealNonce ?? randomSealNonce();
	const sealId = buildRecipientFileSealId(sealIdPrefix, sealNonce);

	args.onProgress?.({ phase: "encrypting" });
	const { ciphertext } = await args.seal.encrypt(args.plaintext, { sealId });

	args.onProgress?.({ phase: "uploading" });
	const upload = await args.walrus.startBlobUpload(ciphertext, args.upload);

	try {
		const tx = upload.certifyTransaction;
		const file = buildNewRecipientFileWithSealPrefix(tx, {
			packageId: config.packageId,
			sealIdPrefix,
			blobId: upload.blobId,
			blobObjectId: upload.blobObjectId,
			name: args.name,
			contentType: args.contentType,
			// Plaintext byte length, per Move contract semantics. The Walrus
			// blob stores the larger ciphertext.
			size: args.plaintext.length,
			recipients: args.recipients,
		});
		buildShareRecipientFile(tx, { packageId: config.packageId, file });

		args.onProgress?.({ phase: "submitting" });
		const result = await submitCombinedTx(adapter, tx, config, {
			blobObjectId: upload.blobObjectId,
			blobId: upload.blobId,
			...(args.signal === undefined ? {} : { signal: args.signal }),
		});
		args.onProgress?.({ phase: "complete" });
		return { ...result, sealIdPrefix, sealNonce };
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
			"uploadRecipientFileFromBytes / uploadEncryptedRecipientFileFromBytes require a WalrusWriteAdapter that implements WalrusFlowCapable (i.e. exposes startBlobUpload). DefaultWalrusWriteAdapter does. Custom adapters without the capability should compose walrus.uploadBlob + createRecipientFile (3 popups) instead.",
			{ operation: "sdk.uploadRecipientFileFromBytes" },
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
	config: MorsePackageConfig,
	args: SubmitCombinedArgs,
): Promise<UploadRecipientFileResult> {
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	// RecipientFile was added in the v3 upgrade; the type identity uses the
	// current published-at, not originalPackageId.
	const fileType = `${config.packageId}::recipient_file::RecipientFile`;
	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		fileId: toRecipientFileId(findCreatedId(receipt, fileType)),
		blobObjectId: args.blobObjectId,
		blobId: args.blobId,
	};
}
