/**
 * High-level entry/revision ops. Non-encrypted, public access policy.
 * Encrypted variants are exposed through a separate set of ops with their
 * own args types.
 *
 * To surface the `u64` returned by Move (`entry_id` on add, `revision_id` on
 * appends/publishes), each id-returning op simulates the PTB first to read
 * the BCS-encoded return value, then signs and executes. Two RPC round-trips
 * per call.
 */

import { Transaction } from "@mysten/sui/transactions";

import type { MorsePackageConfig } from "../config.js";
import {
	buildAddEncryptedEntry,
	buildAddEntry,
	buildAppendDraftRevision,
	buildAppendEncryptedDraftRevision,
	buildDeleteEntry,
	buildPublishDirect,
	buildPublishFromDraft,
} from "../ptb/entry.js";
import type {
	BlobObjectId,
	PublicationId,
	PublisherCapId,
	QuiltPatchId,
	SealId,
	TxReceipt,
} from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import { decodeU64ReturnValue } from "./internal.js";

export interface AddEntryArgs {
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly collectionName: string;
	readonly name: string;
	readonly blobObjectId: BlobObjectId;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
	readonly signal?: AbortSignal;
}

export interface AddEntryResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
	/** Stable monotonic ID assigned to the new entry. */
	readonly entryId: number;
	/** Always `0` for the entry's first revision; surfaced for symmetry with append/publish. */
	readonly revisionId: number;
}

/**
 * Add a new entry to a collection with its first revision, given a
 * pre-uploaded `blobObjectId`. For the typical "upload-then-add" flow,
 * prefer `addEntryFromBytes`, which packs upload + addEntry into 2 wallet
 * popups instead of 3. Use this lower-level form when reusing a blob across
 * multiple entries (deduplication), decoupling upload time from publish
 * time, or pre-uploading from a server.
 *
 * @throws {ContractAbortError} On Move abort.
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function addEntry(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: AddEntryArgs,
): Promise<AddEntryResult> {
	const tx = new Transaction();
	buildAddEntry(tx, {
		packageId: config.packageId,
		publication: args.publicationId,
		publisherCap: args.publisherCapId,
		collectionName: args.collectionName,
		name: args.name,
		blobObjectId: args.blobObjectId,
		...(args.quiltPatchId === undefined
			? {}
			: { quiltPatchId: args.quiltPatchId }),
		contentType: args.contentType,
	});
	const simulated = await adapter.simulateTransaction(tx, args.signal);
	const entryId = decodeU64ReturnValue(simulated, 0, 0);
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		entryId,
		revisionId: 0,
	};
}

export interface AppendDraftRevisionArgs {
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly collectionName: string;
	readonly entryId: number;
	readonly blobObjectId: BlobObjectId;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
	readonly signal?: AbortSignal;
}

export interface RevisionAppendResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
	/** Index of the newly appended revision in the entry's revision vector. */
	readonly revisionId: number;
}

/**
 * Append a draft revision to an existing entry.
 * @throws {ContractAbortError} On Move abort (e.g. entry not found surfaces as
 *   `module: "collection", reason: "EEntryNotFound"`).
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function appendDraftRevision(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: AppendDraftRevisionArgs,
): Promise<RevisionAppendResult> {
	const tx = new Transaction();
	buildAppendDraftRevision(tx, {
		packageId: config.packageId,
		publication: args.publicationId,
		publisherCap: args.publisherCapId,
		collectionName: args.collectionName,
		entryId: args.entryId,
		blobObjectId: args.blobObjectId,
		...(args.quiltPatchId === undefined
			? {}
			: { quiltPatchId: args.quiltPatchId }),
		contentType: args.contentType,
	});
	const simulated = await adapter.simulateTransaction(tx, args.signal);
	const revisionId = decodeU64ReturnValue(simulated, 0, 0);
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		revisionId,
	};
}

export interface PublishFromDraftArgs {
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly collectionName: string;
	readonly entryId: number;
	readonly draftRevisionId: number;
	readonly blobObjectId: BlobObjectId;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
	readonly signal?: AbortSignal;
}

/**
 * Promote a draft to public. Despite the name, this appends a *new* public
 * revision; `draftRevisionId` is only used by the contract to validate that
 * the draft exists. `blobObjectId`/`quiltPatchId` are the published content
 * and may differ from the draft's.
 * @throws {ContractAbortError} On Move abort.
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function publishFromDraft(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: PublishFromDraftArgs,
): Promise<RevisionAppendResult> {
	const tx = new Transaction();
	buildPublishFromDraft(tx, {
		packageId: config.packageId,
		publication: args.publicationId,
		publisherCap: args.publisherCapId,
		collectionName: args.collectionName,
		entryId: args.entryId,
		draftRevisionId: args.draftRevisionId,
		blobObjectId: args.blobObjectId,
		...(args.quiltPatchId === undefined
			? {}
			: { quiltPatchId: args.quiltPatchId }),
		contentType: args.contentType,
	});
	const simulated = await adapter.simulateTransaction(tx, args.signal);
	const revisionId = decodeU64ReturnValue(simulated, 0, 0);
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		revisionId,
	};
}

export interface PublishDirectArgs {
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly collectionName: string;
	readonly entryId: number;
	readonly blobObjectId: BlobObjectId;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
	readonly signal?: AbortSignal;
}

/**
 * Append a public, non-encrypted revision in one step (no draft).
 * @throws {ContractAbortError} On Move abort.
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function publishDirect(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: PublishDirectArgs,
): Promise<RevisionAppendResult> {
	const tx = new Transaction();
	buildPublishDirect(tx, {
		packageId: config.packageId,
		publication: args.publicationId,
		publisherCap: args.publisherCapId,
		collectionName: args.collectionName,
		entryId: args.entryId,
		blobObjectId: args.blobObjectId,
		...(args.quiltPatchId === undefined
			? {}
			: { quiltPatchId: args.quiltPatchId }),
		contentType: args.contentType,
	});
	const simulated = await adapter.simulateTransaction(tx, args.signal);
	const revisionId = decodeU64ReturnValue(simulated, 0, 0);
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		revisionId,
	};
}

export interface DeleteEntryArgs {
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly collectionName: string;
	readonly entryId: number;
	readonly signal?: AbortSignal;
}

export type DeleteEntryResult = TxReceipt;

/**
 * Delete an entry from a collection. No client-side preflight.
 * @throws {ContractAbortError} On Move abort. Missing entry surfaces as
 *   `module: "collection", reason: "EEntryNotFound"`.
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function deleteEntry(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: DeleteEntryArgs,
): Promise<DeleteEntryResult> {
	const tx = new Transaction();
	buildDeleteEntry(tx, {
		packageId: config.packageId,
		publication: args.publicationId,
		publisherCap: args.publisherCapId,
		collectionName: args.collectionName,
		entryId: args.entryId,
	});
	return adapter.signAndExecuteTransaction(tx, args.signal);
}

export interface AddEncryptedEntryArgs {
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly collectionName: string;
	readonly name: string;
	readonly blobObjectId: BlobObjectId;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
	readonly sealId: SealId;
	readonly signal?: AbortSignal;
}

/**
 * Add a new entry whose first revision is encrypted under the supplied
 * `sealId` with the Publisher access policy, given pre-encrypted ciphertext
 * already uploaded to Walrus. For the typical encrypt-upload-add flow,
 * prefer `addEncryptedEntryFromBytes`, which handles encryption and 2-popup
 * upload in a single call. Use this lower-level form when ciphertext
 * already exists, you want to attach the same ciphertext to multiple
 * entries, or you upload from a different process than the one calling
 * this op.
 *
 * @throws {ContractAbortError} On Move abort.
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function addEncryptedEntry(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: AddEncryptedEntryArgs,
): Promise<AddEntryResult> {
	const tx = new Transaction();
	buildAddEncryptedEntry(tx, {
		packageId: config.packageId,
		publication: args.publicationId,
		publisherCap: args.publisherCapId,
		collectionName: args.collectionName,
		name: args.name,
		blobObjectId: args.blobObjectId,
		...(args.quiltPatchId === undefined
			? {}
			: { quiltPatchId: args.quiltPatchId }),
		contentType: args.contentType,
		sealId: args.sealId,
	});
	const simulated = await adapter.simulateTransaction(tx, args.signal);
	const entryId = decodeU64ReturnValue(simulated, 0, 0);
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		entryId,
		revisionId: 0,
	};
}

export interface AppendEncryptedDraftRevisionArgs {
	readonly publicationId: PublicationId;
	readonly publisherCapId: PublisherCapId;
	readonly collectionName: string;
	readonly entryId: number;
	readonly blobObjectId: BlobObjectId;
	readonly quiltPatchId?: QuiltPatchId;
	readonly contentType: string;
	readonly sealId: SealId;
	readonly signal?: AbortSignal;
}

/**
 * Append an encrypted draft revision to an existing entry. Each revision
 * carries its own `sealId`; passing a different identity from the prior
 * revision is valid on-chain.
 *
 * @throws {ContractAbortError} On Move abort.
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function appendEncryptedDraftRevision(
	adapter: WalletAdapter,
	config: MorsePackageConfig,
	args: AppendEncryptedDraftRevisionArgs,
): Promise<RevisionAppendResult> {
	const tx = new Transaction();
	buildAppendEncryptedDraftRevision(tx, {
		packageId: config.packageId,
		publication: args.publicationId,
		publisherCap: args.publisherCapId,
		collectionName: args.collectionName,
		entryId: args.entryId,
		blobObjectId: args.blobObjectId,
		...(args.quiltPatchId === undefined
			? {}
			: { quiltPatchId: args.quiltPatchId }),
		contentType: args.contentType,
		sealId: args.sealId,
	});
	const simulated = await adapter.simulateTransaction(tx, args.signal);
	const revisionId = decodeU64ReturnValue(simulated, 0, 0);
	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		revisionId,
	};
}
