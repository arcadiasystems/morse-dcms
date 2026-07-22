module publication::entry;

use std::string::String;
use Walrus::blob::Blob;

// -- Entry --

/// Maximum allowed length for an entry name.
const MAX_ENTRY_NAME_LENGTH: u64 = 256;

/// Error code: entry name cannot be empty.
const ENameEmpty: u64 = 0;

/// Error code: entry name exceeds maximum length.
const ENameTooLong: u64 = 2;

/// An entry belonging to a collection in a publication.
/// Holds a reference to an existing on-chain Walrus Blob object by its ID.
/// The blob is not wrapped — it remains an independent object.
///
/// Entry data is tracked as immutable revisions with two heads:
/// - `draft_head` for collaboration drafts
/// - `public_head` for published content
///
/// `content_type` is MIME metadata. Lowercase MIME values are recommended for
/// consistency, but casing is not enforced on-chain.
///
/// The blob reference (`blob_ref`) is set at revision creation time.
/// Only deletable blobs are accepted, enforced by requiring the `Blob` object.
public struct Entry has store, drop {
  name: String,
  revisions: vector<EntryRevision>,
  draft_head: Option<u64>,
  public_head: Option<u64>,
}

/// Create a new entry with basic metadata validation.
/// Requires the Walrus `Blob` object and a pre-constructed `BlobRef` (use `make_blob_ref`).
public fun new_entry(
  name: String,
  blob_ref: BlobRef,
  content_type: String,
  encrypted: bool,
  author: address,
  access_policy: u8,
  seal_id: Option<vector<u8>>,
): Entry {
  assert!(!name.is_empty(), ENameEmpty);
  assert!(name.length() <= MAX_ENTRY_NAME_LENGTH, ENameTooLong);
  validate_content_type(&content_type);
  validate_revision_access(encrypted, access_policy, &seal_id);

  let revision = EntryRevision { blob_ref, content_type, encrypted, access_policy, seal_id, author };
  let revisions = vector[revision];
  let draft_head = if (encrypted) option::some(0) else option::none();
  let public_head = if (encrypted) option::none() else option::some(0);

  Entry { name, revisions, draft_head, public_head }
}

/// Return the entry's display name.
public fun name(entry: &Entry): String {
  entry.name
}

/// Return draft head revision ID, if present.
public fun draft_head(entry: &Entry): Option<u64> {
  entry.draft_head
}

/// Return public head revision ID, if present.
public fun public_head(entry: &Entry): Option<u64> {
  entry.public_head
}

// -- Revisions --

/// Maximum allowed length for `content_type` metadata.
const MAX_CONTENT_TYPE_LENGTH: u64 = 255;

/// Expected byte length of a QuiltPatchId: quilt_blob_id (32) || version (1) || start_index (2) || end_index (2).
const QUILT_PATCH_ID_LENGTH: u64 = 37;

/// Access policy: unencrypted/public content.
const ACCESS_PUBLIC: u8 = 0;

/// Access policy: encrypted content readable by active publication publishers.
const ACCESS_PUBLISHER: u8 = 1;

/// Access policy: reserved for future subscription-gated content.
const ACCESS_SUBSCRIPTION: u8 = 2;

/// Error code: content type cannot be empty.
const EContentTypeEmpty: u64 = 1;

/// Error code: content type exceeds maximum length.
const EContentTypeTooLong: u64 = 3;

/// Error code: requested revision does not exist.
const ERevisionNotFound: u64 = 4;

/// Error code: invalid access policy for the selected encryption mode.
const EInvalidAccessPolicy: u64 = 5;

/// Error code: encrypted revisions require a Seal identity.
const ESealIdRequired: u64 = 6;

/// Error code: unencrypted revisions must not include a Seal identity.
const ESealIdNotAllowed: u64 = 7;

/// Error code: blob must be deletable (required by platform policy).
const EBlobNotDeletable: u64 = 8;

/// Error code: quilt collection requires a QuiltPatchId.
const EQuiltPatchIdRequired: u64 = 9;

/// Error code: blob collection must not include a QuiltPatchId.
const EQuiltPatchIdNotAllowed: u64 = 10;

/// Error code: QuiltPatchId must be exactly `QUILT_PATCH_ID_LENGTH` bytes.
const EInvalidQuiltPatchId: u64 = 11;

/// Identifies the Walrus content for a revision.
/// - `Blob(ID)`: Sui object ID of a standalone Walrus Blob (used in STORAGE_MODE_BLOB collections).
/// - `QuiltPatch(vector<u8>)`: 37-byte QuiltPatchId — quilt_blob_id_u256 (32) || version_u8 (1) || start_index_u16 (2) || end_index_u16 (2).
///   Used in STORAGE_MODE_QUILT collections. The quilt blob's Walrus blob_id is embedded in the first 32 bytes.
public enum BlobRef has copy, drop, store {
  Blob(ID),
  QuiltPatch(vector<u8>),
}

/// Immutable blob revision metadata for an entry.
public struct EntryRevision has store, drop {
  blob_ref: BlobRef,
  content_type: String,
  encrypted: bool,
  access_policy: u8,
  seal_id: Option<vector<u8>>,
  author: address,
}

/// Return the numeric value for the public access policy.
public fun access_policy_public(): u8 { ACCESS_PUBLIC }

/// Return the numeric value for the publisher access policy.
public fun access_policy_publisher(): u8 { ACCESS_PUBLISHER }

/// Return the numeric value for the subscription access policy.
public fun access_policy_subscription(): u8 { ACCESS_SUBSCRIPTION }

/// Return the blob reference from the latest revision.
public fun blob_ref(entry: &Entry): BlobRef {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).blob_ref
}

/// Return the entry's MIME content type from the latest revision.
public fun content_type(entry: &Entry): String {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).content_type
}

/// Return whether the latest revision is encrypted.
public fun encrypted(entry: &Entry): bool {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).encrypted
}

/// Return the access policy for the latest revision.
public fun access_policy(entry: &Entry): u8 {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).access_policy
}

/// Return the Seal identity for the latest revision, if any.
public fun seal_id(entry: &Entry): Option<vector<u8>> {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).seal_id
}

/// Return the latest revision author address.
public fun author(entry: &Entry): address {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).author
}

/// Return a specific revision by ID.
public fun revision(entry: &Entry, revision_id: u64): &EntryRevision {
  assert!(revision_id < vector::length(&entry.revisions), ERevisionNotFound);
  vector::borrow(&entry.revisions, revision_id)
}

/// Append a new draft revision and advance the draft head.
/// Requires a pre-constructed `BlobRef` (use `make_blob_ref`).
public fun append_draft_revision(
  entry: &mut Entry,
  blob_ref: BlobRef,
  content_type: String,
  encrypted: bool,
  author: address,
  access_policy: u8,
  seal_id: Option<vector<u8>>,
): u64 {
  validate_content_type(&content_type);
  validate_revision_access(encrypted, access_policy, &seal_id);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(
    &mut entry.revisions,
    EntryRevision { blob_ref, content_type, encrypted, access_policy, seal_id, author },
  );
  entry.draft_head = option::some(revision_id);
  revision_id
}

/// Publish from a draft revision by appending a new public revision.
/// Requires a pre-constructed `BlobRef` (use `make_blob_ref`).
public fun publish_from_draft(
  entry: &mut Entry,
  draft_revision_id: u64,
  blob_ref: BlobRef,
  content_type: String,
  author: address,
): u64 {
  assert!(draft_revision_id < vector::length(&entry.revisions), ERevisionNotFound);
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(
    &mut entry.revisions,
    EntryRevision {
      blob_ref,
      content_type,
      encrypted: false,
      access_policy: ACCESS_PUBLIC,
      seal_id: option::none(),
      author,
    },
  );
  entry.public_head = option::some(revision_id);
  revision_id
}

/// Publish directly by appending a non-encrypted public revision.
/// Requires a pre-constructed `BlobRef` (use `make_blob_ref`).
public fun publish_direct(entry: &mut Entry, blob_ref: BlobRef, content_type: String, author: address): u64 {
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(
    &mut entry.revisions,
    EntryRevision {
      blob_ref,
      content_type,
      encrypted: false,
      access_policy: ACCESS_PUBLIC,
      seal_id: option::none(),
      author,
    },
  );
  entry.public_head = option::some(revision_id);
  revision_id
}

#[test_only]
public(package) fun revision_encrypted(entry: &Entry, revision_id: u64): bool {
  revision(entry, revision_id).encrypted
}

#[test_only]
public(package) fun revision_access_policy(entry: &Entry, revision_id: u64): u8 {
  revision(entry, revision_id).access_policy
}

#[test_only]
public(package) fun revision_has_seal_id(entry: &Entry, revision_id: u64): bool {
  option::is_some(&revision(entry, revision_id).seal_id)
}

/// Test bypass for `new_entry`: accepts a raw `BlobRef` instead of requiring `make_blob_ref`.
/// The deletable check is skipped — use `BlobRef::Blob(id)` or `BlobRef::QuiltPatch(bytes)` directly.
#[test_only]
public(package) fun new_entry_for_testing(
  name: String,
  blob_ref: BlobRef,
  content_type: String,
  encrypted: bool,
  author: address,
  access_policy: u8,
  seal_id: Option<vector<u8>>,
): Entry {
  assert!(!name.is_empty(), ENameEmpty);
  assert!(name.length() <= MAX_ENTRY_NAME_LENGTH, ENameTooLong);
  validate_content_type(&content_type);
  validate_revision_access(encrypted, access_policy, &seal_id);

  let revision = EntryRevision { blob_ref, content_type, encrypted, access_policy, seal_id, author };
  let revisions = vector[revision];
  let draft_head = if (encrypted) option::some(0) else option::none();
  let public_head = if (encrypted) option::none() else option::some(0);

  Entry { name, revisions, draft_head, public_head }
}

/// Test bypass for `append_draft_revision`: accepts a raw `BlobRef`.
#[test_only]
public(package) fun append_draft_revision_for_testing(
  entry: &mut Entry,
  blob_ref: BlobRef,
  content_type: String,
  encrypted: bool,
  author: address,
  access_policy: u8,
  seal_id: Option<vector<u8>>,
): u64 {
  validate_content_type(&content_type);
  validate_revision_access(encrypted, access_policy, &seal_id);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(
    &mut entry.revisions,
    EntryRevision { blob_ref, content_type, encrypted, access_policy, seal_id, author },
  );
  entry.draft_head = option::some(revision_id);
  revision_id
}

/// Test bypass for `publish_from_draft`: accepts a raw `BlobRef`.
#[test_only]
public(package) fun publish_from_draft_for_testing(
  entry: &mut Entry,
  draft_revision_id: u64,
  blob_ref: BlobRef,
  content_type: String,
  author: address,
): u64 {
  assert!(draft_revision_id < vector::length(&entry.revisions), ERevisionNotFound);
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(
    &mut entry.revisions,
    EntryRevision {
      blob_ref,
      content_type,
      encrypted: false,
      access_policy: ACCESS_PUBLIC,
      seal_id: option::none(),
      author,
    },
  );
  entry.public_head = option::some(revision_id);
  revision_id
}

/// Test bypass for `publish_direct`: accepts a raw `BlobRef`.
#[test_only]
public(package) fun publish_direct_for_testing(
  entry: &mut Entry,
  blob_ref: BlobRef,
  content_type: String,
  author: address,
): u64 {
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(
    &mut entry.revisions,
    EntryRevision {
      blob_ref,
      content_type,
      encrypted: false,
      access_policy: ACCESS_PUBLIC,
      seal_id: option::none(),
      author,
    },
  );
  entry.public_head = option::some(revision_id);
  revision_id
}

/// Construct a `BlobRef` from a Walrus `Blob` and optional `QuiltPatchId`, validating
/// that the blob is deletable and that the arguments match the collection's `storage_mode`.
/// This is the canonical way to create a `BlobRef` for production use.
/// - `storage_mode == STORAGE_MODE_BLOB`: `quilt_patch_id` must be `None`; stores blob's Sui object ID.
/// - `storage_mode == STORAGE_MODE_QUILT`: `quilt_patch_id` must be `Some(37 bytes)`; stores the patch ID.
public(package) fun make_blob_ref(
  storage_mode: u8,
  blob: &Blob,
  quilt_patch_id: Option<vector<u8>>,
): BlobRef {
  validate_blob(blob);
  if (storage_mode == 1) { // STORAGE_MODE_QUILT
    assert!(quilt_patch_id.is_some(), EQuiltPatchIdRequired);
    let patch_id = quilt_patch_id.destroy_some();
    assert!(patch_id.length() == QUILT_PATCH_ID_LENGTH, EInvalidQuiltPatchId);
    BlobRef::QuiltPatch(patch_id)
  } else { // STORAGE_MODE_BLOB
    assert!(quilt_patch_id.is_none(), EQuiltPatchIdNotAllowed);
    BlobRef::Blob(object::id(blob))
  }
}

/// Construct a `BlobRef::Blob` variant for use in tests outside this module.
/// Enums are internal to their defining module — this is the approved test constructor.
#[test_only]
public(package) fun blob_ref_blob(blob_id: ID): BlobRef {
  BlobRef::Blob(blob_id)
}

/// Construct a `BlobRef::QuiltPatch` variant for use in tests outside this module.
#[test_only]
public(package) fun blob_ref_quilt_patch(patch_id: vector<u8>): BlobRef {
  BlobRef::QuiltPatch(patch_id)
}

/// Test bypass for `make_blob_ref`: accepts a raw blob ID instead of `&Blob`.
/// Legitimate because `walrus::blob::Blob` cannot be constructed in Move unit tests.
#[test_only]
public(package) fun make_blob_ref_for_testing(
  storage_mode: u8,
  blob_id: ID,
  quilt_patch_id: Option<vector<u8>>,
): BlobRef {
  if (storage_mode == 1) { // STORAGE_MODE_QUILT
    assert!(quilt_patch_id.is_some(), EQuiltPatchIdRequired);
    let patch_id = quilt_patch_id.destroy_some();
    assert!(patch_id.length() == QUILT_PATCH_ID_LENGTH, EInvalidQuiltPatchId);
    BlobRef::QuiltPatch(patch_id)
  } else { // STORAGE_MODE_BLOB
    assert!(quilt_patch_id.is_none(), EQuiltPatchIdNotAllowed);
    BlobRef::Blob(blob_id)
  }
}

// internal
fun validate_blob(blob: &Blob) {
  assert!(blob.is_deletable(), EBlobNotDeletable);
}

// internal
fun latest_revision_id(entry: &Entry): u64 {
  vector::length(&entry.revisions) - 1
}

// internal
fun validate_content_type(content_type: &String) {
  assert!(!content_type.is_empty(), EContentTypeEmpty);
  assert!(content_type.length() <= MAX_CONTENT_TYPE_LENGTH, EContentTypeTooLong);
}

// internal
fun validate_revision_access(encrypted: bool, access_policy: u8, seal_id: &Option<vector<u8>>) {
  if (encrypted) {
    assert!(access_policy == ACCESS_PUBLISHER, EInvalidAccessPolicy);
    assert!(option::is_some(seal_id), ESealIdRequired);
  } else {
    assert!(access_policy == ACCESS_PUBLIC, EInvalidAccessPolicy);
    assert!(!option::is_some(seal_id), ESealIdNotAllowed);
  };
}
