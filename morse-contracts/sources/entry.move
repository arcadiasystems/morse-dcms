module publication::entry;

use std::string::String;

/// Maximum allowed length for an entry name.
const MAX_ENTRY_NAME_LENGTH: u64 = 256;

/// Maximum allowed length for `content_type` metadata.
const MAX_CONTENT_TYPE_LENGTH: u64 = 255;

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

/// Immutable blob revision metadata for an entry.
public struct EntryRevision has store, drop {
  blob: ID,
  content_type: String,
  encrypted: bool,
}

/// An entry belonging to a collection or a named singleton in a publication.
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

/// Create a new entry with basic metadata validation.
public fun new_entry(name: String, content_type: String, blob: ID, encrypted: bool): Entry {
  assert!(!name.is_empty(), ENameEmpty);
  assert!(name.length() <= MAX_ENTRY_NAME_LENGTH, ENameTooLong);
  validate_content_type(&content_type);

  let revision = EntryRevision { blob, content_type, encrypted };
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

/// Append a new draft revision and move draft head.
public fun append_draft_revision(
  entry: &mut Entry,
  content_type: String,
  blob: ID,
  encrypted: bool,
): u64 {
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(&mut entry.revisions, EntryRevision { blob, content_type, encrypted });
  entry.draft_head = option::some(revision_id);
  revision_id
}

/// Publish from a draft revision by appending a new public revision.
public fun publish_from_draft(
  entry: &mut Entry,
  draft_revision_id: u64,
  content_type: String,
  blob: ID,
): u64 {
  assert!(draft_revision_id < vector::length(&entry.revisions), ERevisionNotFound);
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(&mut entry.revisions, EntryRevision { blob, content_type, encrypted: false });
  entry.public_head = option::some(revision_id);
  revision_id
}

/// Publish directly by appending a non-encrypted public revision.
public fun publish_direct(entry: &mut Entry, content_type: String, blob: ID): u64 {
  validate_content_type(&content_type);
  let revision_id = vector::length(&entry.revisions);
  vector::push_back(&mut entry.revisions, EntryRevision { blob, content_type, encrypted: false });
  entry.public_head = option::some(revision_id);
  revision_id
}

fun latest_revision_id(entry: &Entry): u64 {
  vector::length(&entry.revisions) - 1
}

fun validate_content_type(content_type: &String) {
  assert!(!content_type.is_empty(), EContentTypeEmpty);
  assert!(content_type.length() <= MAX_CONTENT_TYPE_LENGTH, EContentTypeTooLong);
}

#[test_only]
use std::unit_test;

#[test_only]
use std::unit_test::assert_eq;

#[test_only]
use std::string;

#[test_only]
fun repeated_ascii_string(len: u64, byte: u8): String {
  let mut bytes = vector[];
  let mut i = 0;
  while (i < len) {
    vector::push_back(&mut bytes, byte);
    i = i + 1;
  };
  string::utf8(bytes)
}

#[test]
fun test_new_entry() {
  let ctx = &mut tx_context::dummy();

  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let mock_blob = object::new(ctx);
  let entry = new_entry(name, content_type, mock_blob.to_inner(), false);

  assert_eq!(entry.name, name);
  assert_eq!(get_content_type(&entry), content_type);
  assert_eq!(get_blob(&entry), mock_blob.to_inner());
  assert_eq!(get_encrypted(&entry), false);

  unit_test::destroy(mock_blob);
  unit_test::destroy(entry);
}

#[test]
fun test_get_name() {
  let ctx = &mut tx_context::dummy();
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let blob = object::new(ctx);
  let entry = new_entry(name, content_type, blob.to_inner(), false);

  assert_eq!(get_name(&entry), name);

  unit_test::destroy(blob);
  unit_test::destroy(entry);
}

#[test]
fun test_get_content_type() {
  let ctx = &mut tx_context::dummy();
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let blob = object::new(ctx);
  let entry = new_entry(name, content_type, blob.to_inner(), false);

  assert_eq!(get_content_type(&entry), content_type);

  unit_test::destroy(blob);
  unit_test::destroy(entry);
}

#[test]
fun test_get_blob() {
  let ctx = &mut tx_context::dummy();
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let blob = object::new(ctx);
  let entry = new_entry(name, content_type, blob.to_inner(), false);

  assert_eq!(get_blob(&entry), blob.to_inner());

  unit_test::destroy(blob);
  unit_test::destroy(entry);
}

#[test]
#[expected_failure(abort_code = ENameEmpty)]
fun test_new_entry_empty_name_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let _entry = new_entry(b"".to_string(), b"application/json".to_string(), blob.to_inner(), false);
  unit_test::destroy(blob);
}

#[test]
#[expected_failure(abort_code = EContentTypeEmpty)]
fun test_new_entry_empty_content_type_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let _entry = new_entry(b"title".to_string(), b"".to_string(), blob.to_inner(), false);
  unit_test::destroy(blob);
}

#[test]
#[expected_failure(abort_code = ENameTooLong)]
fun test_new_entry_name_too_long_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let long_name = repeated_ascii_string(MAX_ENTRY_NAME_LENGTH + 1, 97);
  let _entry = new_entry(long_name, b"application/json".to_string(), blob.to_inner(), false);
  unit_test::destroy(blob);
}

#[test]
#[expected_failure(abort_code = EContentTypeTooLong)]
fun test_new_entry_content_type_too_long_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let long_content_type = repeated_ascii_string(MAX_CONTENT_TYPE_LENGTH + 1, 97);
  let _entry = new_entry(b"title".to_string(), long_content_type, blob.to_inner(), false);
  unit_test::destroy(blob);
}

#[test]
fun test_new_entry_max_boundary_lengths_succeed() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let max_name = repeated_ascii_string(MAX_ENTRY_NAME_LENGTH, 97);
  let max_content_type = repeated_ascii_string(MAX_CONTENT_TYPE_LENGTH, 98);
  let entry = new_entry(max_name, max_content_type, blob.to_inner(), false);

  assert_eq!(get_name(&entry).length(), MAX_ENTRY_NAME_LENGTH);
  assert_eq!(get_content_type(&entry).length(), MAX_CONTENT_TYPE_LENGTH);

  unit_test::destroy(blob);
  unit_test::destroy(entry);
}

#[test]
fun test_new_encrypted_entry_sets_draft_head() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let entry = new_entry(b"draft".to_string(), b"application/json".to_string(), blob.to_inner(), true);

  assert_eq!(get_encrypted(&entry), true);
  assert_eq!(get_draft_head(&entry), option::some(0));
  assert_eq!(get_public_head(&entry), option::none());

  unit_test::destroy(blob);
  unit_test::destroy(entry);
}

#[test]
fun test_append_and_publish_revisions() {
  let ctx = &mut tx_context::dummy();
  let blob_0 = object::new(ctx);
  let blob_1 = object::new(ctx);
  let blob_2 = object::new(ctx);

  let mut entry = new_entry(b"draft".to_string(), b"application/json".to_string(), blob_0.to_inner(), true);
  let draft_rev = append_draft_revision(&mut entry, b"application/json".to_string(), blob_1.to_inner(), true);
  let public_rev = publish_from_draft(&mut entry, draft_rev, b"application/json".to_string(), blob_2.to_inner());

  assert_eq!(draft_rev, 1);
  assert_eq!(public_rev, 2);
  assert_eq!(get_draft_head(&entry), option::some(1));
  assert_eq!(get_public_head(&entry), option::some(2));
  assert_eq!(get_revision(&entry, 2).encrypted, false);

  unit_test::destroy(blob_0);
  unit_test::destroy(blob_1);
  unit_test::destroy(blob_2);
  unit_test::destroy(entry);
}
