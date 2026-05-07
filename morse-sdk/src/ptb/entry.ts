/**
 * PTB builders for entry/revision Move calls. These builders construct
 * non-encrypted, public-access-policy revisions with no seal ID; encrypted
 * variants live in a separate builder set.
 */

import { bcs } from "@mysten/sui/bcs";
import type {
	Transaction,
	TransactionObjectArgument,
	TransactionResult,
} from "@mysten/sui/transactions";

import { accessPolicyToU8 } from "../codecs.js";
import {
	AccessPolicy,
	type BlobObjectId,
	type PackageId,
	type PublicationId,
	type PublisherCapId,
	type QuiltPatchId,
	type SealId,
} from "../types.js";
import { resolveObjectArg } from "./internal.js";

const ACCESS_POLICY_PUBLIC_U8 = 0;
const ENCRYPTED_FALSE = false;
const ENCRYPTED_TRUE = true;

/** Build a `0x1::option::Option<vector<u8>>` Some/None argument. */
function optionPatchIdArg(
	tx: Transaction,
	patchId: QuiltPatchId | undefined,
): TransactionObjectArgument {
	if (patchId === undefined) {
		return tx.pure(bcs.option(bcs.vector(bcs.u8())).serialize(null));
	}
	return tx.pure(
		bcs.option(bcs.vector(bcs.u8())).serialize(Array.from(patchId)),
	);
}

/** Build a `0x1::option::Option<vector<u8>>` `None` for the unused seal_id slot. */
function noSealIdArg(tx: Transaction): TransactionObjectArgument {
	return tx.pure(bcs.option(bcs.vector(bcs.u8())).serialize(null));
}

/** Build a `0x1::option::Option<vector<u8>>` `Some(SealId)` argument. */
function someSealIdArg(
	tx: Transaction,
	sealId: SealId,
): TransactionObjectArgument {
	return tx.pure(
		bcs.option(bcs.vector(bcs.u8())).serialize(Array.from(sealId)),
	);
}

export interface BuildAddEntryArgs {
	readonly packageId: PackageId;
	readonly publication: PublicationId | TransactionObjectArgument;
	readonly publisherCap: PublisherCapId | TransactionObjectArgument;
	readonly collectionName: string;
	readonly name: string;
	readonly blobObjectId: BlobObjectId | TransactionObjectArgument;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
}

/** Add a `publication::add_entry_to_collection` call (returns the new entry's u64 id). */
export function buildAddEntry(
	tx: Transaction,
	args: BuildAddEntryArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::add_entry_to_collection`,
		arguments: [
			resolveObjectArg(tx, args.publication),
			resolveObjectArg(tx, args.publisherCap),
			tx.pure.string(args.collectionName),
			tx.pure.string(args.name),
			resolveObjectArg(tx, args.blobObjectId),
			optionPatchIdArg(tx, args.quiltPatchId),
			tx.pure.string(args.contentType),
			tx.pure.bool(ENCRYPTED_FALSE),
			tx.pure.u8(ACCESS_POLICY_PUBLIC_U8),
			noSealIdArg(tx),
		],
	});
}

export interface BuildAppendDraftRevisionArgs {
	readonly packageId: PackageId;
	readonly publication: PublicationId | TransactionObjectArgument;
	readonly publisherCap: PublisherCapId | TransactionObjectArgument;
	readonly collectionName: string;
	readonly entryId: number;
	readonly blobObjectId: BlobObjectId | TransactionObjectArgument;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
}

/** Add a `publication::append_collection_entry_draft_revision` call (returns u64 revision id). */
export function buildAppendDraftRevision(
	tx: Transaction,
	args: BuildAppendDraftRevisionArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::append_collection_entry_draft_revision`,
		arguments: [
			resolveObjectArg(tx, args.publication),
			resolveObjectArg(tx, args.publisherCap),
			tx.pure.string(args.collectionName),
			tx.pure.u64(args.entryId),
			resolveObjectArg(tx, args.blobObjectId),
			optionPatchIdArg(tx, args.quiltPatchId),
			tx.pure.string(args.contentType),
			tx.pure.bool(ENCRYPTED_FALSE),
			tx.pure.u8(ACCESS_POLICY_PUBLIC_U8),
			noSealIdArg(tx),
		],
	});
}

export interface BuildPublishFromDraftArgs {
	readonly packageId: PackageId;
	readonly publication: PublicationId | TransactionObjectArgument;
	readonly publisherCap: PublisherCapId | TransactionObjectArgument;
	readonly collectionName: string;
	readonly entryId: number;
	readonly draftRevisionId: number;
	readonly blobObjectId: BlobObjectId | TransactionObjectArgument;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
}

/**
 * Add a `publication::publish_collection_entry_from_draft` call. The published
 * revision takes a fresh `blob`/`patchId`; `draftRevisionId` is used only by
 * the contract to validate that the draft exists. Returns u64 revision id.
 */
export function buildPublishFromDraft(
	tx: Transaction,
	args: BuildPublishFromDraftArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::publish_collection_entry_from_draft`,
		arguments: [
			resolveObjectArg(tx, args.publication),
			resolveObjectArg(tx, args.publisherCap),
			tx.pure.string(args.collectionName),
			tx.pure.u64(args.entryId),
			tx.pure.u64(args.draftRevisionId),
			resolveObjectArg(tx, args.blobObjectId),
			optionPatchIdArg(tx, args.quiltPatchId),
			tx.pure.string(args.contentType),
		],
	});
}

export interface BuildPublishDirectArgs {
	readonly packageId: PackageId;
	readonly publication: PublicationId | TransactionObjectArgument;
	readonly publisherCap: PublisherCapId | TransactionObjectArgument;
	readonly collectionName: string;
	readonly entryId: number;
	readonly blobObjectId: BlobObjectId | TransactionObjectArgument;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
}

/** Add a `publication::publish_collection_entry_direct` call (returns u64 revision id). */
export function buildPublishDirect(
	tx: Transaction,
	args: BuildPublishDirectArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::publish_collection_entry_direct`,
		arguments: [
			resolveObjectArg(tx, args.publication),
			resolveObjectArg(tx, args.publisherCap),
			tx.pure.string(args.collectionName),
			tx.pure.u64(args.entryId),
			resolveObjectArg(tx, args.blobObjectId),
			optionPatchIdArg(tx, args.quiltPatchId),
			tx.pure.string(args.contentType),
		],
	});
}

export interface BuildDeleteEntryArgs {
	readonly packageId: PackageId;
	readonly publication: PublicationId | TransactionObjectArgument;
	readonly publisherCap: PublisherCapId | TransactionObjectArgument;
	readonly collectionName: string;
	readonly entryId: number;
}

/** Add a `publication::delete_entry_from_collection` call. */
export function buildDeleteEntry(
	tx: Transaction,
	args: BuildDeleteEntryArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::delete_entry_from_collection`,
		arguments: [
			resolveObjectArg(tx, args.publication),
			resolveObjectArg(tx, args.publisherCap),
			tx.pure.string(args.collectionName),
			tx.pure.u64(args.entryId),
		],
	});
}

export interface BuildAddEncryptedEntryArgs {
	readonly packageId: PackageId;
	readonly publication: PublicationId | TransactionObjectArgument;
	readonly publisherCap: PublisherCapId | TransactionObjectArgument;
	readonly collectionName: string;
	readonly name: string;
	readonly blobObjectId: BlobObjectId | TransactionObjectArgument;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
	readonly sealId: SealId;
}

/**
 * Add a `publication::add_entry_to_collection` call for an encrypted entry
 * (encrypted=true, access_policy=Publisher, seal_id=Some). Returns u64 entry id.
 */
export function buildAddEncryptedEntry(
	tx: Transaction,
	args: BuildAddEncryptedEntryArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::add_entry_to_collection`,
		arguments: [
			resolveObjectArg(tx, args.publication),
			resolveObjectArg(tx, args.publisherCap),
			tx.pure.string(args.collectionName),
			tx.pure.string(args.name),
			resolveObjectArg(tx, args.blobObjectId),
			optionPatchIdArg(tx, args.quiltPatchId),
			tx.pure.string(args.contentType),
			tx.pure.bool(ENCRYPTED_TRUE),
			tx.pure.u8(accessPolicyToU8(AccessPolicy.Publisher)),
			someSealIdArg(tx, args.sealId),
		],
	});
}

export interface BuildAppendEncryptedDraftRevisionArgs {
	readonly packageId: PackageId;
	readonly publication: PublicationId | TransactionObjectArgument;
	readonly publisherCap: PublisherCapId | TransactionObjectArgument;
	readonly collectionName: string;
	readonly entryId: number;
	readonly blobObjectId: BlobObjectId | TransactionObjectArgument;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
	readonly sealId: SealId;
}

/**
 * Add a `publication::append_collection_entry_draft_revision` call for an
 * encrypted draft revision. Returns u64 revision id. Each revision carries
 * its own `sealId`; passing a different identity from the prior revision is
 * valid on-chain.
 */
export function buildAppendEncryptedDraftRevision(
	tx: Transaction,
	args: BuildAppendEncryptedDraftRevisionArgs,
): TransactionResult {
	return tx.moveCall({
		target: `${args.packageId}::publication::append_collection_entry_draft_revision`,
		arguments: [
			resolveObjectArg(tx, args.publication),
			resolveObjectArg(tx, args.publisherCap),
			tx.pure.string(args.collectionName),
			tx.pure.u64(args.entryId),
			resolveObjectArg(tx, args.blobObjectId),
			optionPatchIdArg(tx, args.quiltPatchId),
			tx.pure.string(args.contentType),
			tx.pure.bool(ENCRYPTED_TRUE),
			tx.pure.u8(accessPolicyToU8(AccessPolicy.Publisher)),
			someSealIdArg(tx, args.sealId),
		],
	});
}
