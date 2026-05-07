/**
 * Public barrel for the high-level ops layer.
 */

export {
	type DestroyPublisherCapArgs,
	type DestroyPublisherCapResult,
	destroyPublisherCap,
	type IssuePublisherCapArgs,
	type IssuePublisherCapResult,
	issuePublisherCap,
	type RevokePublisherCapArgs,
	type RevokePublisherCapResult,
	revokePublisherCap,
} from "./cap.js";
export {
	type CreateCollectionArgs,
	type CreateCollectionResult,
	createCollection,
	type DeleteCollectionArgs,
	type DeleteCollectionResult,
	deleteCollection,
} from "./collection.js";
export {
	type AddEncryptedEntryArgs,
	type AddEntryArgs,
	type AddEntryResult,
	type AppendDraftRevisionArgs,
	type AppendEncryptedDraftRevisionArgs,
	addEncryptedEntry,
	addEntry,
	appendDraftRevision,
	appendEncryptedDraftRevision,
	type DeleteEntryArgs,
	type DeleteEntryResult,
	deleteEntry,
	type PublishDirectArgs,
	type PublishFromDraftArgs,
	publishDirect,
	publishFromDraft,
	type RevisionAppendResult,
} from "./entry.js";
export {
	type CreatePublicationArgs,
	type CreatePublicationResult,
	createPublication,
	type DeletePublicationArgs,
	type DeletePublicationResult,
	deletePublication,
	type PublicationConfig,
	type TransferOwnershipArgs,
	type TransferOwnershipResult,
	transferOwnership,
} from "./publication.js";
