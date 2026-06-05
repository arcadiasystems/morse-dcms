/**
 * High-level ops for the `recipient_file` module. Single-Move-call wrappers
 * that build a PTB, sign-and-execute it, and parse the receipt. Composed
 * upload flows live in `recipient-file-from-bytes.ts`.
 */

import { Transaction } from "@mysten/sui/transactions";

import { toRecipientFileId } from "../codecs.js";
import type {
	MorsePackageConfig,
	MorseRecipientFileConfig,
} from "../config.js";
import {
	buildAddRecipient,
	buildDeleteRecipientFile,
	buildNewRecipientFile,
	buildNewRecipientFileWithSealPrefix,
	buildRemoveRecipient,
	buildShareRecipientFile,
	buildTransferRecipientFileOwnership,
	buildUpdateRecipientFileMetadata,
} from "../ptb/recipient-file.js";
import type {
	BlobObjectId,
	RecipientFileId,
	SuiAddress,
	WalrusBlobId,
} from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import { findCreatedId } from "./internal.js";

/** Result returned by recipient-file ops that mutate but do not create. */
export interface RecipientFileOpResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
}

/** Result returned by `createRecipientFile` / `createEncryptedRecipientFile`. */
export interface CreateRecipientFileResult extends RecipientFileOpResult {
	readonly fileId: RecipientFileId;
}

export interface CreateRecipientFileArgs {
	readonly blobId: WalrusBlobId;
	readonly blobObjectId?: BlobObjectId;
	readonly name: string;
	readonly contentType: string;
	readonly size: number;
	readonly recipients: readonly SuiAddress[];
	readonly signal?: AbortSignal;
}

/**
 * Create a `RecipientFile` referencing an already-uploaded Walrus blob. The
 * sender is auto-added to the recipient set; duplicates in `recipients` are
 * silently deduplicated by the Move layer.
 *
 * Builds a single PTB that calls `new_recipient_file` and
 * `share_recipient_file` in sequence so the file is immediately usable.
 *
 * For Seal-encrypted uploads where the seal identity must be bound to the
 * file before signing, use `createEncryptedRecipientFile` (or the one-shot
 * `uploadEncryptedRecipientFileFromBytes`) instead.
 *
 * @throws {ContractAbortError} On Move abort (empty `blobId`, `name`, or
 *   `contentType`; oversized fields).
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function createRecipientFile(
	adapter: WalletAdapter,
	config: MorseRecipientFileConfig,
	args: CreateRecipientFileArgs,
): Promise<CreateRecipientFileResult> {
	const tx = new Transaction();
	const file = buildNewRecipientFile(tx, {
		packageId: config.packageId,
		blobId: args.blobId,
		...(args.blobObjectId === undefined
			? {}
			: { blobObjectId: args.blobObjectId }),
		name: args.name,
		contentType: args.contentType,
		size: args.size,
		recipients: args.recipients,
	});
	buildShareRecipientFile(tx, { packageId: config.packageId, file });

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return parseCreateReceipt(receipt, config);
}

export interface CreateEncryptedRecipientFileArgs
	extends CreateRecipientFileArgs {
	/**
	 * Caller-chosen prefix bytes bound to the file on chain via a dynamic
	 * field. The same prefix must have been used as the leading bytes of the
	 * Seal identity when encrypting the blob this file references; the on-chain
	 * `seal_approve_with_prefix` will validate decryption requests against
	 * exactly these bytes. Use `randomSealPrefix()` for a fresh 32-byte value.
	 */
	readonly sealIdPrefix: Uint8Array;
}

/**
 * Create a `RecipientFile` with an attached Seal identity prefix. The blob
 * referenced by `blobId` is assumed to already be encrypted under a Seal
 * identity of the form `sealIdPrefix || tag(=3) || nonce`. After this PTB
 * lands, recipients can decrypt via `sealAdapter.decryptUnderRecipientFile`.
 *
 * @throws {ContractAbortError} On Move abort (empty `sealIdPrefix` /
 *   `blobId` / `name` / `contentType`, oversized fields).
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function createEncryptedRecipientFile(
	adapter: WalletAdapter,
	config: MorseRecipientFileConfig,
	args: CreateEncryptedRecipientFileArgs,
): Promise<CreateRecipientFileResult> {
	const tx = new Transaction();
	const file = buildNewRecipientFileWithSealPrefix(tx, {
		packageId: config.packageId,
		sealIdPrefix: args.sealIdPrefix,
		blobId: args.blobId,
		...(args.blobObjectId === undefined
			? {}
			: { blobObjectId: args.blobObjectId }),
		name: args.name,
		contentType: args.contentType,
		size: args.size,
		recipients: args.recipients,
	});
	buildShareRecipientFile(tx, { packageId: config.packageId, file });

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return parseCreateReceipt(receipt, config);
}

export interface AddRecipientArgs {
	readonly fileId: RecipientFileId;
	readonly recipient: SuiAddress;
	readonly signal?: AbortSignal;
}

/**
 * Add an address to a recipient file's member set. Owner only. Aborts at the
 * Move layer if the address is already a member (`ERecipientAlreadyPresent`).
 */
export async function addRecipient(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: AddRecipientArgs,
): Promise<RecipientFileOpResult> {
	const tx = new Transaction();
	buildAddRecipient(tx, {
		packageId: config.packageId,
		file: args.fileId,
		recipient: args.recipient,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

export interface RemoveRecipientArgs {
	readonly fileId: RecipientFileId;
	readonly recipient: SuiAddress;
	readonly signal?: AbortSignal;
}

/**
 * Remove an address from a recipient file's member set. Owner only. The owner
 * may remove themselves; doing so revokes decrypt access but does not revoke
 * mutation rights (those still come from the `owner` field).
 */
export async function removeRecipient(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: RemoveRecipientArgs,
): Promise<RecipientFileOpResult> {
	const tx = new Transaction();
	buildRemoveRecipient(tx, {
		packageId: config.packageId,
		file: args.fileId,
		recipient: args.recipient,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

export interface TransferRecipientFileOwnershipArgs {
	readonly fileId: RecipientFileId;
	readonly newOwner: SuiAddress;
	readonly signal?: AbortSignal;
}

/**
 * Transfer mutation rights to a new owner. Does NOT touch `members`; for a
 * full handover (new owner gains decrypt, old owner loses it), compose with
 * `addRecipient` + `removeRecipient` or call them in a custom PTB.
 */
export async function transferRecipientFileOwnership(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: TransferRecipientFileOwnershipArgs,
): Promise<RecipientFileOpResult> {
	const tx = new Transaction();
	buildTransferRecipientFileOwnership(tx, {
		packageId: config.packageId,
		file: args.fileId,
		newOwner: args.newOwner,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

export interface UpdateRecipientFileMetadataArgs {
	readonly fileId: RecipientFileId;
	readonly name: string;
	readonly contentType: string;
	readonly signal?: AbortSignal;
}

/** Update the `name` and `contentType` of a recipient file. Owner only. */
export async function updateRecipientFileMetadata(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: UpdateRecipientFileMetadataArgs,
): Promise<RecipientFileOpResult> {
	const tx = new Transaction();
	buildUpdateRecipientFileMetadata(tx, {
		packageId: config.packageId,
		file: args.fileId,
		name: args.name,
		contentType: args.contentType,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

export interface DeleteRecipientFileArgs {
	readonly fileId: RecipientFileId;
	readonly signal?: AbortSignal;
}

/**
 * Delete a recipient file metadata record. Owner only. Does NOT delete the
 * Walrus blob; that follows the Walrus lease lifecycle independently.
 */
export async function deleteRecipientFile(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: DeleteRecipientFileArgs,
): Promise<RecipientFileOpResult> {
	const tx = new Transaction();
	buildDeleteRecipientFile(tx, {
		packageId: config.packageId,
		file: args.fileId,
	});
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return { digest: receipt.digest, gasUsedMist: receipt.gasUsedMist };
}

function parseCreateReceipt(
	receipt: Awaited<ReturnType<WalletAdapter["signAndExecuteTransaction"]>>,
	config: MorseRecipientFileConfig,
): CreateRecipientFileResult {
	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		fileId: toRecipientFileId(
			findCreatedId(receipt, recipientFileType(config)),
		),
	};
}

/**
 * Fully-qualified object-type string for a created `RecipientFile`.
 *
 * Sui stamps a created object with the package id where its struct was FIRST
 * defined (the "type origin"), not the current published-at. For
 * `RecipientFile` that origin is `recipientFileEventOriginPackageId`. Falls
 * back to `packageId` for fresh deployments with no upgrades, where the two
 * are equal.
 */
export function recipientFileType(config: MorseRecipientFileConfig): string {
	const origin = config.recipientFileEventOriginPackageId ?? config.packageId;
	return `${origin}::recipient_file::RecipientFile`;
}
