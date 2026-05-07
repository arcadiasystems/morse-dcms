/**
 * Public domain types, mirroring `morse-contracts`.
 *
 * Mapping conventions: Move `u64` to `number`; Move `Option<T>` to `T | null`;
 * Move enums to string-discriminated unions; object IDs are branded strings.
 */

// Branded IDs

type Brand<T, Tag extends string> = T & { readonly __brand: Tag };

/** Sui package ID of a deployed `publication` Move package. */
export type PackageId = Brand<string, "PackageId">;

/** Sui object ID of the shared `PublicationRegistry`. */
export type RegistryId = Brand<string, "RegistryId">;

/** Sui object ID of a `Publication`. */
export type PublicationId = Brand<string, "PublicationId">;

/** Sui object ID of an `OwnerCap`. */
export type OwnerCapId = Brand<string, "OwnerCapId">;

/** Sui object ID of a `PublisherCap`. */
export type PublisherCapId = Brand<string, "PublisherCapId">;

/** Sui object ID of a Walrus `Blob`. */
export type BlobObjectId = Brand<string, "BlobObjectId">;

/**
 * Walrus content-addressed blob ID. URL-safe base64 of the 32-byte content
 * digest, 43 chars without padding. Distinct from `BlobObjectId`, which is
 * the Sui object holding the blob.
 */
export type WalrusBlobId = Brand<string, "WalrusBlobId">;

/**
 * 37-byte quilt patch ID: `quilt_id(32) || version(1) || start(2) || end(2)`,
 * u16 indices little-endian (BCS canonical). Branded to prevent accidental
 * passing of arbitrary byte arrays to APIs that expect a validated patch ID.
 */
export type QuiltPatchId = Uint8Array & { readonly __brand: "QuiltPatchId" };

/**
 * Seal identity bytes. Layout: `publication_id(32) || policy_tag(u8) || nonce(>=1)`.
 * Total length must be > 33. Branded so callers cannot bypass the identity
 * builder; construct via `buildPublisherSealId`.
 */
export type SealId = Uint8Array & { readonly __brand: "SealId" };

/** Hex-encoded Sui account address. */
export type SuiAddress = Brand<string, "SuiAddress">;

/** Generic Sui object ID for objects without a more specific brand. */
export type SuiObjectId = Brand<string, "SuiObjectId">;

// Storage mode

/**
 * Collection content layout on Walrus: standalone blobs per entry (`blob`, u8=0)
 * or patches in a shared quilt (`quilt`, u8=1).
 */
export const StorageMode = {
	Blob: "blob",
	Quilt: "quilt",
} as const;
export type StorageMode = (typeof StorageMode)[keyof typeof StorageMode];

// Access policy

/**
 * Who may decrypt an entry revision. Move u8: public=0, publisher=1, subscription=2.
 * `subscription` is reserved; the Move layer does not yet accept it.
 */
export const AccessPolicy = {
	Public: "public",
	Publisher: "publisher",
	Subscription: "subscription",
} as const;
export type AccessPolicy = (typeof AccessPolicy)[keyof typeof AccessPolicy];

// Seal policy tag

/** Policy tag byte inside a Seal identity, identifying the approval entrypoint. */
export const SealPolicyTag = {
	Publisher: 1,
} as const;
export type SealPolicyTag = (typeof SealPolicyTag)[keyof typeof SealPolicyTag];

// BlobRef

/**
 * Walrus content reference for a revision. `blob` holds a Sui object ID;
 * `quilt` holds a 37-byte `QuiltPatchId`.
 */
export type BlobRef =
	| { readonly kind: "blob"; readonly blobObjectId: BlobObjectId }
	| { readonly kind: "quilt"; readonly patchId: QuiltPatchId };

/** Byte length of a QuiltPatchId, enforced by the Move layer. */
export const QUILT_PATCH_ID_LENGTH = 37;

// Revision

/** One immutable revision of an entry. Mutations are appended, never edited in place. */
export interface Revision {
	/** Zero-based index into the entry's revision vector. */
	readonly id: number;
	readonly blobRef: BlobRef;
	/** MIME content type; casing is not enforced on-chain. */
	readonly contentType: string;
	readonly encrypted: boolean;
	readonly accessPolicy: AccessPolicy;
	/** Seal identity bound to encrypted revisions; `null` when unencrypted. */
	readonly sealId: SealId | null;
	/** Address that submitted the transaction creating this revision. */
	readonly author: SuiAddress;
}

// Entry

/** One entry within a collection; revisions are append-only with draft and public heads. */
export interface Entry {
	/** Monotonic ID assigned on insert; stable across deletions. */
	readonly id: number;
	readonly name: string;
	readonly revisions: readonly Revision[];
	readonly draftHead: number | null;
	readonly publicHead: number | null;
}

// Collection

/** One collection within a publication. `storageMode` is immutable after creation. */
export interface Collection {
	readonly name: string;
	readonly storageMode: StorageMode;
	readonly nextEntryId: number;
	/** Sui object ID of the dynamic-field table holding entries. */
	readonly entriesTableId: SuiObjectId;
}

// Publication

/** Top-level container for collections. Slug is unique across active publications. */
export interface Publication {
	readonly id: PublicationId;
	readonly name: string;
	readonly slug: string;
	readonly collections: readonly Collection[];
	/** Sui object ID of the denylist table tracking revoked PublisherCaps. */
	readonly revokedPublisherCapsTableId: SuiObjectId;
}

// Capabilities

/** Owner capability; issues and revokes PublisherCaps, deletes the publication. Transferable. */
export interface OwnerCap {
	readonly id: OwnerCapId;
	readonly publicationId: PublicationId;
}

/** Write-access capability bound to `holder`; multiple may exist per publication. */
export interface PublisherCap {
	readonly id: PublisherCapId;
	readonly publicationId: PublicationId;
	readonly holder: SuiAddress;
}

// Transaction receipt

/** One object created by a transaction. */
export interface TxCreatedObject {
	readonly objectId: SuiObjectId;
	/**
	 * Move type tag, e.g. `0x35b5..::publication::Publication`. Treat as opaque;
	 * use exact string match against a known type, not substring matching.
	 */
	readonly objectType: string;
}

/** One object deleted by a transaction. */
export interface TxDeletedObject {
	readonly objectId: SuiObjectId;
}

/**
 * Result of a signed transaction. `gasUsedMist = computationCost + storageCost - storageRebate`;
 * negative values are possible when storage is freed.
 */
export interface TxReceipt {
	readonly digest: string;
	readonly gasUsedMist: bigint;
	readonly createdObjects: readonly TxCreatedObject[];
	readonly deletedObjects: readonly TxDeletedObject[];
}
