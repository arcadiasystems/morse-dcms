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
/// `blob` is a raw ID reference. Existence/provenance are not validated in this
/// module — only the deletable constraint is enforced at revision creation time
/// by requiring the caller to pass the `Blob` object.
public struct Entry has store, drop {
  name: String,
  revisions: vector<EntryRevision>,
  draft_head: Option<u64>,
  public_head: Option<u64>,
}

/// Create a new entry with basic metadata validation.
/// Requires the Walrus `Blob` object to enforce the deletable constraint.
public fun new_entry(
  name: String,
  blob: &Blob,
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
  let blob_id = validate_blob(blob);

  let revision = EntryRevision { blob: blob_id, content_type, encrypted, access_policy, seal_id, author };
  let revisions = vector[revision];
  let draft_head = if (encrypted) option::some(0) else option::none();
  let public_head = if (encrypted) option::none() else option::some(0);

  Entry { name, revisions, draft_head, public_head }
}

/// Return the entry's display name.
public fun get_name(entry: &Entry): String {
  entry.name
}

/// Return draft head revision ID, if present.
public fun get_draft_head(entry: &Entry): Option<u64> {
  entry.draft_head
}

/// Return public head revision ID, if present.
public fun get_public_head(entry: &Entry): Option<u64> {
  entry.public_head
}

// -- Revisions --

/// Maximum allowed length for `content_type` metadata.
const MAX_CONTENT_TYPE_LENGTH: u64 = 255;

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

/// Immutable blob revision metadata for an entry.
public struct EntryRevision has store, drop {
  blob: ID,
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

/// Return the entry's MIME content type from the latest revision.
public fun get_content_type(entry: &Entry): String {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).content_type
}

/// Return the referenced blob object ID from the latest revision.
public fun get_blob(entry: &Entry): ID {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).blob
}

/// Return whether the latest revision is encrypted.
public fun get_encrypted(entry: &Entry): bool {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).encrypted
}

/// Return the access policy for the latest revision.
public fun get_access_policy(entry: &Entry): u8 {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).access_policy
}

/// Return the Seal identity for the latest revision, if any.
public fun get_seal_id(entry: &Entry): Option<vector<u8>> {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).seal_id
}

/// Return the latest revision author address.
public fun get_author(entry: &Entry): address {
  vector::borrow(&entry.revisions, latest_revision_id(entry)).author
}

/// Return a specific revision by ID.
public fun get_revision(entry: &Entry, revision_id: u64): &EntryRevision {
  assert!(revision_id < vector::length(&entry.revisions), ERevisionNotFound);
  vector::borrow(&entry.revisions, revision_id)
}

/// Append a new draft revision and advance the draft head.
/// Requires the Walrus `Blob` object to enforce the deletable constraint.
public fun append_draft_revision(
  entry: &mut Entry,
  blob: &Blob,
  content_type: String,
  encrypted: bool,
  author: address,
  access_policy: u8,
  seal_id: Option<vector<u8>>,
): u64 {
  validate_content_type(&content_type);
  validate_revision_access(encrypted, access_policy, &seal_id);
  let blob_id = validate_blob(blob);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(
    &mut entry.revisions,
    EntryRevision { blob: blob_id, content_type, encrypted, access_policy, seal_id, author },
  );
  entry.draft_head = option::some(revision_id);
  revision_id
}

/// Publish from a draft revision by appending a new public revision.
/// Requires the Walrus `Blob` object to enforce the deletable constraint.
public fun publish_from_draft(
  entry: &mut Entry,
  draft_revision_id: u64,
  blob: &Blob,
  content_type: String,
  author: address,
): u64 {
  assert!(draft_revision_id < vector::length(&entry.revisions), ERevisionNotFound);
  validate_content_type(&content_type);
  let blob_id = validate_blob(blob);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(
    &mut entry.revisions,
    EntryRevision {
      blob: blob_id,
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
/// Requires the Walrus `Blob` object to enforce the deletable constraint.
public fun publish_direct(entry: &mut Entry, blob: &Blob, content_type: String, author: address): u64 {
  validate_content_type(&content_type);
  let blob_id = validate_blob(blob);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(
    &mut entry.revisions,
    EntryRevision {
      blob: blob_id,
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
  get_revision(entry, revision_id).encrypted
}

#[test_only]
public(package) fun revision_access_policy(entry: &Entry, revision_id: u64): u8 {
  get_revision(entry, revision_id).access_policy
}

#[test_only]
public(package) fun revision_has_seal_id(entry: &Entry, revision_id: u64): bool {
  option::is_some(&get_revision(entry, revision_id).seal_id)
}

/// Test bypass for `new_entry`: accepts a raw `blob_id` instead of `&Blob`.
/// Legitimate because `walrus::blob::Blob` cannot be constructed in Move unit tests —
/// `blob::new` is `public(package)` and Walrus provides no `#[test_only]` blob constructor.
#[test_only]
public(package) fun new_entry_for_testing(
  name: String,
  blob_id: ID,
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

  let revision = EntryRevision { blob: blob_id, content_type, encrypted, access_policy, seal_id, author };
  let revisions = vector[revision];
  let draft_head = if (encrypted) option::some(0) else option::none();
  let public_head = if (encrypted) option::none() else option::some(0);

  Entry { name, revisions, draft_head, public_head }
}

/// Test bypass for `append_draft_revision`: accepts a raw `blob_id` instead of `&Blob`.
#[test_only]
public(package) fun append_draft_revision_for_testing(
  entry: &mut Entry,
  blob_id: ID,
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
    EntryRevision { blob: blob_id, content_type, encrypted, access_policy, seal_id, author },
  );
  entry.draft_head = option::some(revision_id);
  revision_id
}

/// Test bypass for `publish_from_draft`: accepts a raw `blob_id` instead of `&Blob`.
#[test_only]
public(package) fun publish_from_draft_for_testing(
  entry: &mut Entry,
  draft_revision_id: u64,
  blob_id: ID,
  content_type: String,
  author: address,
): u64 {
  assert!(draft_revision_id < vector::length(&entry.revisions), ERevisionNotFound);
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(
    &mut entry.revisions,
    EntryRevision {
      blob: blob_id,
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

/// Test bypass for `publish_direct`: accepts a raw `blob_id` instead of `&Blob`.
#[test_only]
public(package) fun publish_direct_for_testing(
  entry: &mut Entry,
  blob_id: ID,
  content_type: String,
  author: address,
): u64 {
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(
    &mut entry.revisions,
    EntryRevision {
      blob: blob_id,
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

// internal
fun validate_blob(blob: &Blob): ID {
  assert!(blob.is_deletable(), EBlobNotDeletable);
  object::id(blob)
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
