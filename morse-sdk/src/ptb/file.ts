/**
 * PTB builders for `file` module Move calls. Internal to the SDK;
 * `ops/file.ts` composes these into single atomic transactions.
 */

import type {
	Transaction,
	TransactionArgument,
	TransactionResult,
} from "@mysten/sui/transactions";

import type {
	AllowlistId,
	BlobObjectId,
	EncryptedFileId,
	PackageId,
	SuiAddress,
	WalrusBlobId,
} from "../types.js";

/** Canonical Sui clock shared object id. The `file::new_*` calls take it as input. */
const SUI_CLOCK_OBJECT_ID = "0x6";

export interface BuildNewEncryptedFileArgs {
	readonly packageId: PackageId;
	readonly blobId: WalrusBlobId;
	readonly blobObjectId?: BlobObjectId;
	readonly name: string;
	readonly contentType: string;
	readonly size: bigint;
	readonly allowlistId: AllowlistId;
}

/**
 * Add a `file::new_encrypted_file` call. Returns the new EncryptedFile as the
 * first result. The caller must follow with `share_file` to make it accessible
 * from any wallet.
 */
export function buildNewEncryptedFile(
	tx: Transaction,
	args: BuildNewEncryptedFileArgs,
): TransactionResult {
	const blobIdBytes = walrusBlobIdToBytes(args.blobId);
	return tx.moveCall({
		target: `${args.packageId}::file::new_encrypted_file`,
		arguments: [
			tx.pure.vector("u8", Array.from(blobIdBytes)),
			optionSomeId(tx, args.blobObjectId),
			tx.pure.string(args.name),
			tx.pure.string(args.contentType),
			tx.pure.u64(args.size),
			tx.pure.address(args.allowlistId as unknown as string),
			tx.object(SUI_CLOCK_OBJECT_ID),
		],
	});
}

export interface BuildNewPublicFileArgs {
	readonly packageId: PackageId;
	readonly blobId: WalrusBlobId;
	readonly blobObjectId?: BlobObjectId;
	readonly name: string;
	readonly contentType: string;
	readonly size: bigint;
}

/**
 * Add a `file::new_public_file` call. Returns the new EncryptedFile (the
 * `encrypted` flag is false). Follow with `share_file`.
 */
export function buildNewPublicFile(
	tx: Transaction,
	args: BuildNewPublicFileArgs,
): TransactionResult {
	const blobIdBytes = walrusBlobIdToBytes(args.blobId);
	return tx.moveCall({
		target: `${args.packageId}::file::new_public_file`,
		arguments: [
			tx.pure.vector("u8", Array.from(blobIdBytes)),
			optionSomeId(tx, args.blobObjectId),
			tx.pure.string(args.name),
			tx.pure.string(args.contentType),
			tx.pure.u64(args.size),
			tx.object(SUI_CLOCK_OBJECT_ID),
		],
	});
}

export interface BuildShareFileArgs {
	readonly packageId: PackageId;
	readonly file: TransactionArgument;
}

export function buildShareFile(
	tx: Transaction,
	args: BuildShareFileArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::file::share_file`,
		arguments: [args.file],
	});
}

export interface BuildUpdateFileMetadataArgs {
	readonly packageId: PackageId;
	readonly fileId: EncryptedFileId;
	readonly name: string;
	readonly contentType: string;
}

export function buildUpdateFileMetadata(
	tx: Transaction,
	args: BuildUpdateFileMetadataArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::file::update_metadata`,
		arguments: [
			tx.object(args.fileId),
			tx.pure.string(args.name),
			tx.pure.string(args.contentType),
		],
	});
}

export interface BuildTransferFileOwnershipArgs {
	readonly packageId: PackageId;
	readonly fileId: EncryptedFileId;
	readonly newOwner: SuiAddress;
}

export function buildTransferFileOwnership(
	tx: Transaction,
	args: BuildTransferFileOwnershipArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::file::transfer_ownership`,
		arguments: [tx.object(args.fileId), tx.pure.address(args.newOwner)],
	});
}

export interface BuildDeleteFileArgs {
	readonly packageId: PackageId;
	readonly fileId: EncryptedFileId;
}

export function buildDeleteFile(
	tx: Transaction,
	args: BuildDeleteFileArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::file::delete_file`,
		arguments: [tx.object(args.fileId)],
	});
}

/**
 * Walrus blob IDs are 43-char URL-safe base64 strings carrying a 32-byte
 * content digest. The Move layer stores them as `vector<u8>`; we decode the
 * 32 bytes here for the PTB so on-chain reads match what Walrus returns.
 */
function walrusBlobIdToBytes(blobId: WalrusBlobId): Uint8Array {
	const base64 = (blobId as unknown as string)
		.replace(/-/g, "+")
		.replace(/_/g, "/");
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}

/**
 * Build a Move `Option<ID>` argument. Sui's PTB layer does not have a native
 * Option builder, so we go through the std::option helpers.
 */
function optionSomeId(
	tx: Transaction,
	value: BlobObjectId | undefined,
): TransactionResult {
	if (value === undefined) {
		return tx.moveCall({
			target: "0x1::option::none",
			typeArguments: ["0x2::object::ID"],
			arguments: [],
		});
	}
	return tx.moveCall({
		target: "0x1::option::some",
		typeArguments: ["0x2::object::ID"],
		arguments: [tx.pure.id(value)],
	});
}
