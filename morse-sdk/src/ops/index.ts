/**
 * Public barrel for the high-level ops layer.
 */

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
