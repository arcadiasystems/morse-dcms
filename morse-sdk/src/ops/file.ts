/**
 * High-level file ops: build a PTB, sign and execute via the wallet adapter,
 * parse the receipt into a typed result.
 *
 * Encrypted-file creation here registers the metadata record assuming the
 * encrypted bytes are already on Walrus. The all-in-one upload+register
 * flow is `uploadEncryptedFileFromBytes` in `file-from-bytes.ts`.
 */

import {
	Transaction,
	type TransactionObjectArgument,
} from "@mysten/sui/transactions";

import { toEncryptedFileId } from "../codecs.js";
import type { MorsePackageConfig } from "../config.js";
import { ValidationError } from "../errors.js";
import {
	buildDeleteFile,
	buildNewEncryptedFile,
	buildNewPublicFile,
	buildShareFile,
	buildTransferFileOwnership,
	buildUpdateFileMetadata,
} from "../ptb/file.js";
import type {
	AllowlistId,
	BlobObjectId,
	EncryptedFileId,
	SuiAddress,
	WalrusBlobId,
} from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import { findCreatedId } from "./internal.js";

const MAX_FILE_NAME_LENGTH = 256;
const MAX_CONTENT_TYPE_LENGTH = 255;

export interface CreateEncryptedFileArgs {
	readonly allowlistId: AllowlistId;
	readonly blobId: WalrusBlobId;
	readonly blobObjectId?: BlobObjectId;
	readonly name: string;
	readonly contentType: string;
	readonly size: bigint;
	readonly signal?: AbortSignal;
}

export interface CreateFileResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
	readonly fileId: EncryptedFileId;
}

/**
 * Register on-chain metadata for an encrypted file already uploaded to Walrus.
 * The bytes at `blobId` MUST be Seal-encrypted under an identity built from
 * `allowlistId` (see `buildAllowlistSealId`); otherwise consumers will fail
 * to decrypt. The SDK does not verify this binding.
 *
 * @throws {ValidationError} If `name` or `contentType` is empty or exceeds length limits.
 * @throws {ContractAbortError} On Move abort (e.g. empty blob_id).
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function createEncryptedFile(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: CreateEncryptedFileArgs,
): Promise<CreateFileResult> {
	validateFileFields(args.name, args.contentType);

	const tx = new Transaction();
	const created = buildNewEncryptedFile(tx, {
		packageId: config.packageId,
		blobId: args.blobId,
		...(args.blobObjectId === undefined
			? {}
			: { blobObjectId: args.blobObjectId }),
		name: args.name,
		contentType: args.contentType,
		size: args.size,
		allowlistId: args.allowlistId,
	});
	const fileArg = created as unknown as TransactionObjectArgument;
	buildShareFile(tx, { packageId: config.packageId, file: fileArg });

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	// See ops/allowlist.ts: file::EncryptedFile was introduced in v2; type
	// identity is rooted at config.packageId, not originalPackageId.
	const typePrefix = config.packageId;

	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		fileId: toEncryptedFileId(
			findCreatedId(receipt, `${typePrefix}::file::EncryptedFile`),
		),
	};
}

export interface CreatePublicFileArgs {
	readonly blobId: WalrusBlobId;
	readonly blobObjectId?: BlobObjectId;
	readonly name: string;
	readonly contentType: string;
	readonly size: bigint;
	readonly signal?: AbortSignal;
}

/**
 * Register on-chain metadata for an unencrypted file. The bytes at `blobId`
 * are publicly readable via the Walrus aggregator.
 */
export async function createPublicFile(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: CreatePublicFileArgs,
): Promise<CreateFileResult> {
	validateFileFields(args.name, args.contentType);

	const tx = new Transaction();
	const created = buildNewPublicFile(tx, {
		packageId: config.packageId,
		blobId: args.blobId,
		...(args.blobObjectId === undefined
			? {}
			: { blobObjectId: args.blobObjectId }),
		name: args.name,
		contentType: args.contentType,
		size: args.size,
	});
	const fileArg = created as unknown as TransactionObjectArgument;
	buildShareFile(tx, { packageId: config.packageId, file: fileArg });

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	// See ops/allowlist.ts: file::EncryptedFile was introduced in v2; type
	// identity is rooted at config.packageId, not originalPackageId.
	const typePrefix = config.packageId;

	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		fileId: toEncryptedFileId(
			findCreatedId(receipt, `${typePrefix}::file::EncryptedFile`),
		),
	};
}

export interface UpdateFileMetadataArgs {
	readonly fileId: EncryptedFileId;
	readonly name: string;
	readonly contentType: string;
	readonly signal?: AbortSignal;
}

export interface FileOpResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
}

/**
 * Update the file's `name` and `content_type`. Other fields are immutable
 * post-creation; create a new file record to swap the blob or change the
 * allowlist. Owner only (sender must equal `file.owner` on-chain).
 */
export async function updateFileMetadata(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: UpdateFileMetadataArgs,
): Promise<FileOpResult> {
	validateFileFields(args.name, args.contentType);

	const tx = new Transaction();
	buildUpdateFileMetadata(tx, {
		packageId: config.packageId,
		fileId: args.fileId,
		name: args.name,
		contentType: args.contentType,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

export interface TransferFileOwnershipArgs {
	readonly fileId: EncryptedFileId;
	readonly newOwner: SuiAddress;
	readonly signal?: AbortSignal;
}

/**
 * Transfer the metadata-mutation right to a new address. Decryption access
 * is governed separately by the file's allowlist; the new owner must be
 * added to that allowlist (and the previous owner removed, if desired) by
 * the Cap holder. The two operations can be composed in one PTB by the
 * caller if both rights need to move together.
 */
export async function transferFileOwnership(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: TransferFileOwnershipArgs,
): Promise<FileOpResult> {
	const tx = new Transaction();
	buildTransferFileOwnership(tx, {
		packageId: config.packageId,
		fileId: args.fileId,
		newOwner: args.newOwner,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

export interface DeleteFileArgs {
	readonly fileId: EncryptedFileId;
	readonly signal?: AbortSignal;
}

/**
 * Delete the on-chain metadata record. Does NOT delete the Walrus blob;
 * that follows the Walrus lease lifecycle independently.
 */
export async function deleteFile(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: DeleteFileArgs,
): Promise<FileOpResult> {
	const tx = new Transaction();
	buildDeleteFile(tx, {
		packageId: config.packageId,
		fileId: args.fileId,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

function validateFileFields(name: string, contentType: string): void {
	if (name.length === 0) {
		throw new ValidationError("File name cannot be empty", "name");
	}
	if (name.length > MAX_FILE_NAME_LENGTH) {
		throw new ValidationError(
			`File name exceeds ${MAX_FILE_NAME_LENGTH} chars`,
			"name",
		);
	}
	if (contentType.length === 0) {
		throw new ValidationError("Content type cannot be empty", "contentType");
	}
	if (contentType.length > MAX_CONTENT_TYPE_LENGTH) {
		throw new ValidationError(
			`Content type exceeds ${MAX_CONTENT_TYPE_LENGTH} chars`,
			"contentType",
		);
	}
}
