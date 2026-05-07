/**
 * Public barrel for the high-level ops layer.
 */

export {
	type CapConfig,
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
