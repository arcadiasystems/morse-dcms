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
	type TransferPublisherCapArgs,
	type TransferPublisherCapResult,
	transferPublisherCap,
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
	type AddEncryptedEntryFromBytesArgs,
	type AddEntryFromBytesArgs,
	type AddEntryFromBytesResult,
	addEncryptedEntryFromBytes,
	addEntryFromBytes,
	type ProgressCallback,
	type ProgressEvent,
} from "./entry-from-bytes.js";
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
export {
	type AddRecipientArgs,
	addRecipient,
	type CreateEncryptedRecipientFileArgs,
	type CreateRecipientFileArgs,
	type CreateRecipientFileResult,
	createEncryptedRecipientFile,
	createRecipientFile,
	type DeleteRecipientFileArgs,
	deleteRecipientFile,
	type RecipientFileOpResult,
	type RemoveRecipientArgs,
	removeRecipient,
	type TransferRecipientFileOwnershipArgs,
	transferRecipientFileOwnership,
	type UpdateRecipientFileMetadataArgs,
	updateRecipientFileMetadata,
} from "./recipient-file.js";
export {
	type FileUploadProgressCallback,
	type FileUploadProgressEvent,
	type UploadEncryptedRecipientFileArgs,
	type UploadEncryptedRecipientFileResult,
	type UploadRecipientFileArgs,
	type UploadRecipientFileResult,
	uploadEncryptedRecipientFileFromBytes,
	uploadRecipientFileFromBytes,
} from "./recipient-file-from-bytes.js";
