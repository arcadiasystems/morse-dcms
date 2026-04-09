module publication::entry;

use std::string::String;

// --- Constants ---

/// Maximum allowed length for an entry name.
const MAX_ENTRY_NAME_LENGTH: u64 = 256;

/// Maximum allowed length for `content_type` metadata.
const MAX_CONTENT_TYPE_LENGTH: u64 = 255;

// --- Error codes ---

/// Error code: entry name cannot be empty.
const ENameEmpty: u64 = 0;

/// Error code: content type cannot be empty.
const EContentTypeEmpty: u64 = 1;

/// Error code: entry name exceeds maximum length.
const ENameTooLong: u64 = 2;

/// Error code: content type exceeds maximum length.
const EContentTypeTooLong: u64 = 3;

/// Error code: requested revision does not exist.
const ERevisionNotFound: u64 = 4;

// --- Data structures ---

/// Immutable blob revision metadata for an entry.
public struct EntryRevision has store, drop {
  blob: ID,
  content_type: String,
  encrypted: bool,
  author: address,
}

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
/// module.
public struct Entry has store, drop {
  name: String,
  revisions: vector<EntryRevision>,
  draft_head: Option<u64>,
  public_head: Option<u64>,
}

// --- Public API ---

/// Create a new entry with basic metadata validation.
public fun new_entry(name: String, content_type: String, blob: ID, encrypted: bool, author: address): Entry {
  assert!(!name.is_empty(), ENameEmpty);
  assert!(name.length() <= MAX_ENTRY_NAME_LENGTH, ENameTooLong);
  validate_content_type(&content_type);

  let revision = EntryRevision { blob, content_type, encrypted, author };
  let revisions = vector[revision];
  let draft_head = if (encrypted) option::some(0) else option::none();
  let public_head = if (encrypted) option::none() else option::some(0);

  Entry {
    name,
    revisions,
    draft_head,
    public_head,
  }
}

/// Return the entry's display name.
public fun get_name(entry: &Entry): String {
  entry.name
}

/// Return the entry's MIME content type metadata.
public fun get_content_type(entry: &Entry): String {
  let revision_id = latest_revision_id(entry);
  vector::borrow(&entry.revisions, revision_id).content_type
}

/// Return the referenced blob object ID.
public fun get_blob(entry: &Entry): ID {
  let revision_id = latest_revision_id(entry);
  vector::borrow(&entry.revisions, revision_id).blob
}

/// Return whether the latest revision is encrypted.
public fun get_encrypted(entry: &Entry): bool {
  let revision_id = latest_revision_id(entry);
  vector::borrow(&entry.revisions, revision_id).encrypted
}

/// Return the latest revision author address.
public fun get_author(entry: &Entry): address {
  let revision_id = latest_revision_id(entry);
  vector::borrow(&entry.revisions, revision_id).author
}

/// Return draft head revision ID, if present.
public fun get_draft_head(entry: &Entry): Option<u64> {
  entry.draft_head
}

/// Return public head revision ID, if present.
public fun get_public_head(entry: &Entry): Option<u64> {
  entry.public_head
}

/// Return a specific revision by ID.
public fun get_revision(entry: &Entry, revision_id: u64): &EntryRevision {
  assert!(revision_id < vector::length(&entry.revisions), ERevisionNotFound);
  vector::borrow(&entry.revisions, revision_id)
}

#[test_only]
public(package) fun revision_encrypted(entry: &Entry, revision_id: u64): bool {
  get_revision(entry, revision_id).encrypted
}

/// Append a new draft revision and move draft head.
public fun append_draft_revision(
  entry: &mut Entry,
  content_type: String,
  blob: ID,
  encrypted: bool,
  author: address,
): u64 {
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(&mut entry.revisions, EntryRevision { blob, content_type, encrypted, author });
  entry.draft_head = option::some(revision_id);
  revision_id
}

/// Publish from a draft revision by appending a new public revision.
public fun publish_from_draft(
  entry: &mut Entry,
  draft_revision_id: u64,
  content_type: String,
  blob: ID,
  author: address,
): u64 {
  assert!(draft_revision_id < vector::length(&entry.revisions), ERevisionNotFound);
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(&mut entry.revisions, EntryRevision { blob, content_type, encrypted: false, author });
  entry.public_head = option::some(revision_id);
  revision_id
}

/// Publish directly by appending a non-encrypted public revision.
public fun publish_direct(entry: &mut Entry, content_type: String, blob: ID, author: address): u64 {
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(&mut entry.revisions, EntryRevision { blob, content_type, encrypted: false, author });
  entry.public_head = option::some(revision_id);
  revision_id
}

// --- Internal helpers ---

fun latest_revision_id(entry: &Entry): u64 {
  vector::length(&entry.revisions) - 1
}

fun validate_content_type(content_type: &String) {
  assert!(!content_type.is_empty(), EContentTypeEmpty);
  assert!(content_type.length() <= MAX_CONTENT_TYPE_LENGTH, EContentTypeTooLong);
}
