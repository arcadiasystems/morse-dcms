/**
 * PTB builders for the `recipient_file` module. Internal to the SDK; `ops/`
 * composes these into single atomic transactions. All builders target
 * `config.packageId` (the current published-at) because the
 * `recipient_file` module was added in a package upgrade; calling it at
 * `originalPackageId` would resolve to the v1 bytecode where the module
 * does not exist.
 */

import type {
	Transaction,
	TransactionArgument,
	TransactionObjectArgument,
	TransactionResult,
} from "@mysten/sui/transactions";

import { ValidationError } from "../errors.js";
import type {
	BlobObjectId,
	PackageId,
	RecipientFileId,
	SuiAddress,
	WalrusBlobId,
} from "../types.js";
import { resolveObjectArg } from "./internal.js";

/** Walrus system `Clock` shared object. Required by `new_recipient_file*`. */
export const SUI_CLOCK_OBJECT_ID = "0x6";

export interface BuildNewRecipientFileArgs {
	readonly packageId: PackageId;
	readonly blobId: WalrusBlobId;
	readonly blobObjectId?: BlobObjectId;
	readonly name: string;
	readonly contentType: string;
	readonly size: number;
	readonly recipients: readonly SuiAddress[];
}

/**
 * Add a `recipient_file::new_recipient_file` call. Returns the created
 * `RecipientFile` by value; the caller must consume it (typically via
 * `buildShareRecipientFile` in the same PTB).
 */
export function buildNewRecipientFile(
	tx: Transaction,
	args: BuildNewRecipientFileArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::recipient_file::new_recipient_file`,
		arguments: [
			tx.pure.vector("u8", Array.from(walrusBlobIdToBytes(args.blobId))),
			optionObjectId(tx, args.blobObjectId),
			tx.pure.string(args.name),
			tx.pure.string(args.contentType),
			tx.pure.u64(args.size),
			tx.pure.vector("address", [...args.recipients]),
			tx.object(SUI_CLOCK_OBJECT_ID),
		],
	});
}

export interface BuildNewRecipientFileWithSealPrefixArgs
	extends BuildNewRecipientFileArgs {
	readonly sealIdPrefix: Uint8Array;
}

/**
 * Add a `recipient_file::new_recipient_file_with_seal_prefix` call. The
 * supplied prefix is the bytes that Seal identities for this file's
 * encrypted content must start with (followed by tag=3 and a per-encrypt
 * nonce). Returns the created `RecipientFile` by value.
 */
export function buildNewRecipientFileWithSealPrefix(
	tx: Transaction,
	args: BuildNewRecipientFileWithSealPrefixArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::recipient_file::new_recipient_file_with_seal_prefix`,
		arguments: [
			tx.pure.vector("u8", Array.from(args.sealIdPrefix)),
			tx.pure.vector("u8", Array.from(walrusBlobIdToBytes(args.blobId))),
			optionObjectId(tx, args.blobObjectId),
			tx.pure.string(args.name),
			tx.pure.string(args.contentType),
			tx.pure.u64(args.size),
			tx.pure.vector("address", [...args.recipients]),
			tx.object(SUI_CLOCK_OBJECT_ID),
		],
	});
}

export interface BuildShareRecipientFileArgs {
	readonly packageId: PackageId;
	readonly file: TransactionArgument;
}

/** Add a `recipient_file::share_recipient_file` call. Consumes the file. */
export function buildShareRecipientFile(
	tx: Transaction,
	args: BuildShareRecipientFileArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::recipient_file::share_recipient_file`,
		arguments: [args.file],
	});
}

export interface BuildAddRecipientArgs {
	readonly packageId: PackageId;
	readonly file: RecipientFileId | TransactionObjectArgument;
	readonly recipient: SuiAddress;
}

/** Add a `recipient_file::add_recipient` call. */
export function buildAddRecipient(
	tx: Transaction,
	args: BuildAddRecipientArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::recipient_file::add_recipient`,
		arguments: [
			resolveObjectArg(tx, args.file),
			tx.pure.address(args.recipient),
		],
	});
}

export interface BuildRemoveRecipientArgs {
	readonly packageId: PackageId;
	readonly file: RecipientFileId | TransactionObjectArgument;
	readonly recipient: SuiAddress;
}

/** Add a `recipient_file::remove_recipient` call. */
export function buildRemoveRecipient(
	tx: Transaction,
	args: BuildRemoveRecipientArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::recipient_file::remove_recipient`,
		arguments: [
			resolveObjectArg(tx, args.file),
			tx.pure.address(args.recipient),
		],
	});
}

export interface BuildTransferRecipientFileOwnershipArgs {
	readonly packageId: PackageId;
	readonly file: RecipientFileId | TransactionObjectArgument;
	readonly newOwner: SuiAddress;
}

/**
 * Add a `recipient_file::transfer_ownership` call. Does NOT touch `members`;
 * compose with `add_recipient`/`remove_recipient` for a full handover.
 */
export function buildTransferRecipientFileOwnership(
	tx: Transaction,
	args: BuildTransferRecipientFileOwnershipArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::recipient_file::transfer_ownership`,
		arguments: [
			resolveObjectArg(tx, args.file),
			tx.pure.address(args.newOwner),
		],
	});
}

export interface BuildUpdateRecipientFileMetadataArgs {
	readonly packageId: PackageId;
	readonly file: RecipientFileId | TransactionObjectArgument;
	readonly name: string;
	readonly contentType: string;
}

/** Add a `recipient_file::update_metadata` call. */
export function buildUpdateRecipientFileMetadata(
	tx: Transaction,
	args: BuildUpdateRecipientFileMetadataArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::recipient_file::update_metadata`,
		arguments: [
			resolveObjectArg(tx, args.file),
			tx.pure.string(args.name),
			tx.pure.string(args.contentType),
		],
	});
}

export interface BuildDeleteRecipientFileArgs {
	readonly packageId: PackageId;
	readonly file: RecipientFileId | TransactionObjectArgument;
}

/** Add a `recipient_file::delete_file` call. Consumes the file. */
export function buildDeleteRecipientFile(
	tx: Transaction,
	args: BuildDeleteRecipientFileArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::recipient_file::delete_file`,
		arguments: [resolveObjectArg(tx, args.file)],
	});
}

function optionObjectId(
	tx: Transaction,
	id: BlobObjectId | undefined,
): TransactionArgument {
	if (id === undefined) {
		return tx.moveCall({
			target: "0x1::option::none",
			typeArguments: ["0x2::object::ID"],
		});
	}
	return tx.moveCall({
		target: "0x1::option::some",
		typeArguments: ["0x2::object::ID"],
		arguments: [tx.pure.id(id as string)],
	});
}

const WALRUS_BLOB_ID_CHARS = 43;

/**
 * Walrus blob ids are 43-char URL-safe base64 (32 bytes decoded). The Move
 * contract expects raw bytes. Decoding here keeps PTB builders pure.
 *
 * Defends against a mis-branded input by asserting the length even though
 * `toWalrusBlobId` already validates at the codec entry. Surfaces a
 * meaningful error rather than an opaque `atob` exception if the brand
 * invariant is ever violated.
 */
function walrusBlobIdToBytes(blobId: WalrusBlobId): Uint8Array {
	const raw = blobId as string;
	if (raw.length !== WALRUS_BLOB_ID_CHARS) {
		throw new ValidationError(
			`WalrusBlobId must be ${WALRUS_BLOB_ID_CHARS} chars; got ${raw.length}`,
			"blobId",
		);
	}
	// URL-safe base64 -> standard base64. 43 chars -> single `=` padding.
	const padded = `${raw.replace(/-/g, "+").replace(/_/g, "/")}=`;
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
