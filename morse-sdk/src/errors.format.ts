/**
 * Convert any `MorseError` (or unknown throw) into a `{ title, description }`
 * pair suitable for end-user UI surfaces (toast headers + bodies, dialog
 * titles + content, banner messages). Pure function; preserves the original
 * `cause` for consumers who want to narrow further.
 *
 * Copy is intentionally domain-neutral. The SDK uses the protocol's own
 * terminology ("publication", "entry", "PublisherCap"); consumer dapps
 * translating to their domain (blog → post, gallery → image, docs →
 * article) should override per-class in their own catch blocks.
 *
 * @example
 * ```ts
 * import { formatUserMessage } from "@arcadiasystems/morse-sdk";
 * try { await addEntryFromBytes(...); }
 * catch (err) {
 *   const { title, description } = formatUserMessage(err);
 *   toast.error(title, { description });
 * }
 * ```
 */

import {
	ABORT_CODES,
	type AbortModule,
	ConfigurationError,
	ContractAbortError,
	MorseError,
	NotFoundError,
	type NotFoundResource,
	SealError,
	type SealErrorCode,
	TransportError,
	UNKNOWN_ABORT_NAME,
	UncertifiedBlobError,
	ValidationError,
} from "./errors.js";

/** Structured UI-ready translation of an error. */
export interface FormattedError {
	/** Short headline, suitable for a toast title or dialog header. */
	readonly title: string;
	/** Longer body, suitable for a toast description or dialog content. */
	readonly description: string;
	/** Original error preserved verbatim for narrowing or logging. */
	readonly cause: unknown;
}

/**
 * Translate any error into a UI-ready `{ title, description }`. Accepts
 * `unknown` so consumers can use it directly in a catch block without
 * narrowing first; non-`MorseError` throws fall back to a generic message.
 *
 * For domain-specific copy ("blog post" instead of "publication entry"),
 * narrow on the error class first and write your own message, then fall
 * back to `formatUserMessage` for the rest.
 */
export function formatUserMessage(err: unknown): FormattedError {
	if (err instanceof ContractAbortError) return formatAbort(err);
	if (err instanceof SealError) return formatSeal(err);
	if (err instanceof UncertifiedBlobError) return formatUncertified(err);
	if (err instanceof NotFoundError) return formatNotFound(err);
	if (err instanceof ValidationError) return formatValidation(err);
	if (err instanceof TransportError) return formatTransport(err);
	if (err instanceof ConfigurationError) return formatConfiguration(err);
	if (err instanceof MorseError) return formatGenericMorse(err);
	return formatUnknown(err);
}

// Contract abort

interface AbortCopyOverride {
	readonly title: string;
	readonly description?: string;
}

// Title overrides per abort reason; descriptions are overridden only where
// the ABORT_CODES entry leaks internal constants or BCS byte layouts.
const ABORT_OVERRIDES: Readonly<Record<string, AbortCopyOverride>> = {
	ESlugAlreadyExists: { title: "Slug already taken" },
	EPublisherCapRevoked: { title: "Access revoked" },
	EPublisherCapWrongHolder: { title: "Wrong wallet" },
	EUnauthorized: { title: "Unauthorized" },
	ESealIdRequired: { title: "Seal identity required" },
	ESealIdNotAllowed: { title: "Seal identity not allowed" },
	ESealInvalidId: { title: "Invalid Seal identity" },
	ESealWrongPolicyTag: { title: "Unsupported Seal policy" },
	ESlugEmpty: { title: "Slug required" },
	ESlugTooLong: { title: "Slug too long" },
	ESlugInvalidChar: { title: "Invalid slug character" },
	ESlugInvalidEdgeHyphen: { title: "Invalid slug edge" },
	ECollectionAlreadyExists: { title: "Collection already exists" },
	EEntryNotFound: { title: "Entry not found" },
	ERevisionNotFound: { title: "Revision not found" },
	ENameEmpty: { title: "Name required" },
	EContentTypeEmpty: { title: "Content type required" },
	ENameTooLong: { title: "Name too long" },
	EContentTypeTooLong: { title: "Content type too long" },
	EBlobNotDeletable: { title: "Blob must be deletable" },
	EQuiltPatchIdRequired: { title: "Quilt patch ID required" },
	EQuiltPatchIdNotAllowed: { title: "Quilt patch ID not allowed" },
	EInvalidAccessPolicy: { title: "Invalid access policy" },
	EInvalidStorageMode: {
		title: "Invalid storage mode",
		description: "Storage mode must be Blob or Quilt.",
	},
	EInvalidQuiltPatchId: {
		title: "Invalid quilt patch ID",
		description: "QuiltPatchId must be exactly 37 bytes.",
	},
	[UNKNOWN_ABORT_NAME]: {
		title: "Contract aborted",
		description:
			"The deployed contract may be newer than this SDK. Upgrade or report the abort code.",
	},
};

function formatAbort(err: ContractAbortError): FormattedError {
	const override = ABORT_OVERRIDES[err.reason];
	const tableDescription = lookupAbortDescription(err.module, err.abortCode);
	return {
		title: override?.title ?? "Contract aborted",
		description:
			override?.description ??
			tableDescription ??
			`Contract aborted: ${err.module}::${err.reason} (code ${err.abortCode}).`,
		cause: err,
	};
}

function lookupAbortDescription(
	module: AbortModule,
	abortCode: number,
): string | undefined {
	return ABORT_CODES[module][abortCode]?.description;
}

// Seal

const SEAL_COPY: Readonly<
	Record<SealErrorCode, Omit<FormattedError, "cause">>
> = {
	"no-access": {
		title: "No access",
		description:
			"Your wallet does not have permission to decrypt this content.",
	},
	"decrypt-failed": {
		title: "Decryption failed",
		description:
			"The ciphertext could not be decrypted. It may have been tampered with, or the Seal identity does not match.",
	},
	"session-expired": {
		title: "Session expired",
		description:
			"Your Seal session key has expired. Sign a new SessionKey to continue.",
	},
	"rate-limited": {
		title: "Rate limited",
		description:
			"Seal key servers rejected too many requests. Wait a moment and retry.",
	},
};

function formatSeal(err: SealError): FormattedError {
	const copy = SEAL_COPY[err.code];
	return { ...copy, cause: err };
}

// UncertifiedBlob

function formatUncertified(err: UncertifiedBlobError): FormattedError {
	return {
		title: "Upload incomplete",
		description: `The Walrus blob was uploaded but the on-chain transaction failed. Blob ID: ${err.blobId} (object ${err.blobObjectId}). Retry the operation to attach it, or wait for the storage registration to expire.`,
		cause: err,
	};
}

// NotFound

const NOT_FOUND_TITLES: Readonly<Record<NotFoundResource, string>> = {
	publication: "Publication not found",
	collection: "Collection not found",
	entry: "Entry not found",
	revision: "Revision not found",
	"publisher-cap": "PublisherCap not found",
	"owner-cap": "OwnerCap not found",
	registry: "Registry not found",
	blob: "Content unavailable",
	allowlist: "Allowlist not found",
	"encrypted-file": "File not found",
};

function formatNotFound(err: NotFoundError): FormattedError {
	const title = NOT_FOUND_TITLES[err.resource];
	const description =
		err.resource === "blob"
			? `The Walrus blob is not retrievable. The storage operator may be having issues, or the blob expired. (id: ${err.identifier})`
			: `No ${err.resource} at ${err.identifier}.`;
	return { title, description, cause: err };
}

// Validation / Transport / Configuration

function formatValidation(err: ValidationError): FormattedError {
	return {
		title: "Invalid input",
		description:
			err.field === "" ? err.message : `${err.field}: ${err.message}`,
		cause: err,
	};
}

function formatTransport(err: TransportError): FormattedError {
	const base =
		err.message.length > 0
			? err.message
			: "Could not reach the network. Please retry.";
	// Operation is an internal discriminator (e.g. "sui.getObject"). Surface
	// it as a parenthetical tag so support tickets carry the failing call
	// without forcing consumers to parse `err.cause` themselves.
	const description =
		err.operation === undefined ? base : `${base} (${err.operation})`;
	return {
		title: "Network issue",
		description,
		cause: err,
	};
}

function formatConfiguration(err: ConfigurationError): FormattedError {
	return {
		title: "Configuration issue",
		description: err.message,
		cause: err,
	};
}

// Catch-alls

function formatGenericMorse(err: MorseError): FormattedError {
	return {
		title: "SDK error",
		description: err.message,
		cause: err,
	};
}

function formatUnknown(err: unknown): FormattedError {
	const description =
		err instanceof Error && err.message.length > 0
			? err.message
			: "An unexpected error occurred. Please retry.";
	return {
		title: "Unexpected error",
		description,
		cause: err,
	};
}
