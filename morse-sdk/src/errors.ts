/**
 * Error hierarchy. All errors extend `MorseError`; narrow subclasses via `instanceof`.
 */

// Base

/** Abstract base for every error thrown by the SDK. */
export abstract class MorseError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = new.target.name;
	}
}

// Validation

/** Client-side precondition failed (malformed ID, invalid enum, etc). */
export class ValidationError extends MorseError {
	/** Name of the field or parameter that failed validation. */
	readonly field: string;

	constructor(message: string, field: string, options?: { cause?: unknown }) {
		super(message, options);
		this.field = field;
	}
}

// Not found

export type NotFoundResource =
	| "publication"
	| "collection"
	| "entry"
	| "revision"
	| "publisher-cap"
	| "owner-cap"
	| "registry"
	| "blob"
	| "recipient-file";

/** Resource not found on-chain. */
export class NotFoundError extends MorseError {
	readonly resource: NotFoundResource;
	readonly identifier: string;

	constructor(
		resource: NotFoundResource,
		identifier: string,
		options?: { cause?: unknown },
	) {
		super(`${resource} not found: ${identifier}`, options);
		this.resource = resource;
		this.identifier = identifier;
	}
}

// Unauthorized

/** Authorization check failed client-side, before the transaction was submitted. */
export class UnauthorizedError extends MorseError {}

// Transport

/**
 * RPC transport, network, or response-parsing failure. Distinct from contract
 * aborts. Optionally carries an `operation` discriminator naming the RPC
 * method, HTTP endpoint, or SDK call that failed. Consumers can switch on
 * it without parsing the message string. Conventions:
 *
 * - Sui RPC reads: `sui.getObject`, `sui.listOwnedObjects`, etc.
 * - Walrus direct: `walrus.uploadBlob`, `walrus.startBlobUpload`, `walrus.readBlob`, etc.
 * - Walrus HTTP: `walrus.publisher.uploadBlob`, `walrus.aggregator.readBlob`, etc.
 * - Seal: `seal.encrypt`, `seal.decrypt`, `seal.buildApproveTx`.
 *
 * Operation is optional for backward compatibility; pre-0.1.2 throw sites
 * may surface a `TransportError` without it.
 */
export class TransportError extends MorseError {
	readonly operation?: string;

	constructor(
		message: string,
		options?: { cause?: unknown; operation?: string },
	) {
		super(message, options);
		if (options?.operation !== undefined) {
			this.operation = options.operation;
		}
	}
}

// Configuration

/** SDK configuration gap (e.g. asking for a network with no canonical deployment). */
export class ConfigurationError extends MorseError {}

/**
 * Discriminator for `UnsupportedWalletSchemeError`. `non-canonical-pubkey`
 * means `account.publicKey` did not decode at construction time; the rest
 * mean the async recovery flow failed for a specific reason. Consumers
 * branch on `code` rather than message strings, and `fromAccountAsync`
 * only attempts recovery when `code === "non-canonical-pubkey"`.
 */
export type UnsupportedWalletSchemeCode =
	| "non-canonical-pubkey"
	| "malformed-zklogin"
	| "recovery-sig-length"
	| "recovery-non-ed25519"
	| "recovery-address-mismatch";

/**
 * Raised by `WalletStandardSigner.fromAccount` and `fromAccountAsync` when
 * the account's public key cannot be resolved to a verified Ed25519/Secp/
 * Passkey/ZkLogin key matching `account.address`. Narrow on `code` to
 * distinguish the failure mode; carries the raw bytes and reported address
 * for support telemetry and CTA copy. Phantom's Sui adapter is the known
 * source: it returns a 59-byte opaque blob in `account.publicKey`, which
 * surfaces as `code: "non-canonical-pubkey"`.
 */
export class UnsupportedWalletSchemeError extends ConfigurationError {
	readonly code: UnsupportedWalletSchemeCode;
	readonly publicKeyBytes: Readonly<Uint8Array>;
	readonly address: string;
	readonly walletName?: string;

	constructor(
		message: string,
		fields: {
			code: UnsupportedWalletSchemeCode;
			publicKeyBytes: Uint8Array;
			address: string;
			walletName?: string;
		},
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.code = fields.code;
		this.publicKeyBytes = fields.publicKeyBytes;
		this.address = fields.address;
		if (fields.walletName !== undefined) {
			this.walletName = fields.walletName;
		}
	}
}

// Uncertified blob

/**
 * Thrown by `addEntryFromBytes` / `addEncryptedEntryFromBytes` when the
 * register-and-upload step succeeded (the user already paid for storage and
 * the bytes are on Walrus storage nodes) but the combined `certify_blob +
 * add_entry` transaction failed (rejected popup, contract abort, network
 * blip). The blob exists on Sui as an uncertified `Blob` object that is
 * holding storage until either the consumer certifies it or the storage
 * registration expires.
 *
 * Carries `blobObjectId` and `blobId` so the consumer can surface them to the
 * user (e.g. "your upload was wasted; here is the blob id for support") or
 * retry the flow with fresh bytes. The original failure is preserved as
 * `cause`.
 */
export class UncertifiedBlobError extends MorseError {
	readonly blobObjectId: string;
	readonly blobId: string;

	constructor(
		blobObjectId: string,
		blobId: string,
		options?: { cause?: unknown },
	) {
		super(
			`Walrus blob ${blobObjectId} was registered and uploaded but the certify transaction failed; the blob is on storage nodes but uncertified. Retry the full flow with fresh bytes, or wait for the storage registration to expire.`,
			options,
		);
		this.blobObjectId = blobObjectId;
		this.blobId = blobId;
	}
}

// Seal

/** Distinct failure modes Seal exposes to consumers. Narrow on `code`. */
export type SealErrorCode =
	| "no-access"
	| "decrypt-failed"
	| "session-expired"
	| "rate-limited";

/**
 * Seal encryption or decryption failed for a content reason (not transport).
 * Use this to distinguish authorization gaps (`no-access`) from network
 * blips (`TransportError`).
 */
export class SealError extends MorseError {
	readonly code: SealErrorCode;

	constructor(
		code: SealErrorCode,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.code = code;
	}
}

// Contract abort

/** Move module whose abort codes the SDK knows about. */
export type AbortModule =
	| "publication"
	| "collection"
	| "entry"
	| "recipient_file";

/** One row of the abort-code table. */
export interface AbortEntry {
	readonly name: string;
	readonly description: string;
}

/**
 * Move abort codes mirrored from `morse-contracts`. Structure: `ABORT_CODES[module][code]`.
 * New abort constants in the Move package must be added here, or they surface as `UnknownAbort`.
 */
export const ABORT_CODES: {
	readonly [M in AbortModule]: { readonly [code: number]: AbortEntry };
} = {
	publication: {
		0: {
			name: "ECollectionAlreadyExists",
			description:
				"A collection with this name already exists in the publication.",
		},
		2: {
			name: "EUnauthorized",
			description: "The capability does not belong to this publication.",
		},
		4: {
			name: "EPublisherCapWrongHolder",
			description:
				"The sender is not the approved holder for this PublisherCap.",
		},
		5: {
			name: "EPublisherCapRevoked",
			description:
				"The PublisherCap has been revoked and can no longer be used.",
		},
		6: {
			name: "ESlugAlreadyExists",
			description: "A publication with this slug already exists.",
		},
		7: {
			name: "ESlugEmpty",
			description: "Slug cannot be empty.",
		},
		8: {
			name: "ESlugTooLong",
			description: "Slug exceeds the maximum allowed length.",
		},
		9: {
			name: "ESlugInvalidChar",
			description:
				"Slug contains characters outside the allowed set (lowercase alphanumeric and hyphen).",
		},
		10: {
			name: "ESlugInvalidEdgeHyphen",
			description: "Slug must not start or end with a hyphen.",
		},
		12: {
			name: "ESealInvalidId",
			description:
				"Provided Seal identity does not match this publication namespace.",
		},
		13: {
			name: "ESealWrongPolicyTag",
			description: "Provided Seal identity has an unsupported policy tag.",
		},
	},
	collection: {
		0: {
			name: "EEntryNotFound",
			description: "No entry exists for the requested entry_id.",
		},
		1: {
			name: "EInvalidStorageMode",
			description:
				"Storage mode must be STORAGE_MODE_BLOB (0) or STORAGE_MODE_QUILT (1).",
		},
	},
	entry: {
		0: {
			name: "ENameEmpty",
			description: "Entry name cannot be empty.",
		},
		1: {
			name: "EContentTypeEmpty",
			description: "Content type cannot be empty.",
		},
		2: {
			name: "ENameTooLong",
			description: "Entry name exceeds the maximum allowed length.",
		},
		3: {
			name: "EContentTypeTooLong",
			description: "Content type exceeds the maximum allowed length.",
		},
		4: {
			name: "ERevisionNotFound",
			description: "Requested revision does not exist.",
		},
		5: {
			name: "EInvalidAccessPolicy",
			description:
				"Access policy is not valid for the selected encryption mode.",
		},
		6: {
			name: "ESealIdRequired",
			description: "Encrypted revisions require a Seal identity.",
		},
		7: {
			name: "ESealIdNotAllowed",
			description: "Unencrypted revisions must not include a Seal identity.",
		},
		8: {
			name: "EBlobNotDeletable",
			description:
				"Blob must be deletable; non-deletable blobs are rejected by platform policy.",
		},
		9: {
			name: "EQuiltPatchIdRequired",
			description:
				"Quilt-mode collections require a QuiltPatchId on every revision.",
		},
		10: {
			name: "EQuiltPatchIdNotAllowed",
			description: "Blob-mode collections must not include a QuiltPatchId.",
		},
		11: {
			name: "EInvalidQuiltPatchId",
			description:
				"QuiltPatchId must be exactly 37 bytes (quilt_blob_id || version || start_index || end_index).",
		},
	},
	recipient_file: {
		0: {
			name: "EUnauthorized",
			description: "Sender is not the file owner.",
		},
		1: {
			name: "EBlobIdEmpty",
			description: "blob_id must be non-empty.",
		},
		2: {
			name: "ENameInvalid",
			description: "name must be non-empty and within 256 chars.",
		},
		3: {
			name: "EContentTypeInvalid",
			description: "content_type must be non-empty and within 255 chars.",
		},
		4: {
			name: "ERecipientAlreadyPresent",
			description: "Address is already a recipient of this file.",
		},
		5: {
			name: "ERecipientNotPresent",
			description: "Address is not a recipient of this file.",
		},
		6: {
			name: "ESealInvalidId",
			description:
				"Provided Seal identity does not match this recipient_file namespace.",
		},
		7: {
			name: "ESealWrongPolicyTag",
			description: "Provided Seal identity has an unsupported policy tag.",
		},
		8: {
			name: "ENoAccess",
			description: "Sender is not a recipient of this file.",
		},
		9: {
			name: "ESealPrefixEmpty",
			description: "Caller-supplied Seal identity prefix must be non-empty.",
		},
		10: {
			name: "ESealPrefixMissing",
			description:
				"File has no attached Seal identity prefix; use the legacy seal_approve path or create the file via new_recipient_file_with_seal_prefix.",
		},
	},
};

/** Reason value used when a Move abort code is not in the SDK's table. */
export const UNKNOWN_ABORT_NAME = "UnknownAbort";

/** Move VM aborted during transaction execution. Narrow on `reason` (e.g. "EPublisherCapRevoked"). */
export class ContractAbortError extends MorseError {
	readonly module: AbortModule;
	readonly abortCode: number;
	readonly reason: string;

	constructor(
		module: AbortModule,
		abortCode: number,
		reason: string,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.module = module;
		this.abortCode = abortCode;
		this.reason = reason;
	}

	/** Build an error by looking up `(module, abortCode)` in the abort-code table. */
	static fromAbortCode(
		module: AbortModule,
		abortCode: number,
		options?: { cause?: unknown },
	): ContractAbortError {
		const entry = ABORT_CODES[module][abortCode];
		if (entry === undefined) {
			return new ContractAbortError(
				module,
				abortCode,
				UNKNOWN_ABORT_NAME,
				`Contract aborted in ${module} with unknown code ${abortCode}. The deployed package may be newer than this SDK.`,
				options,
			);
		}
		return new ContractAbortError(
			module,
			abortCode,
			entry.name,
			`Contract aborted: ${module}::${entry.name} (code ${abortCode}). ${entry.description}`,
			options,
		);
	}
}
