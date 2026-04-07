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

/// An entry belonging to a collection or a named singleton in a publication.
/// Holds a reference to an existing on-chain Walrus Blob object by its ID.
/// The blob is not wrapped — it remains an independent object and can be
/// replaced by removing this entry and inserting a new one.
///
/// `content_type` is MIME metadata. Lowercase MIME values are recommended for
/// consistency, but casing is not enforced on-chain.
///
/// `blob` is a raw ID reference. Existence/provenance are not validated in this
/// module.
public struct Entry has store, drop {
  name: String,
  content_type: String,
  blob: ID,
}

/// Create a new entry with basic metadata validation.
public fun new_entry(name: String, content_type: String, blob: ID): Entry {
  assert!(!name.is_empty(), ENameEmpty);
  assert!(!content_type.is_empty(), EContentTypeEmpty);
  assert!(name.length() <= MAX_ENTRY_NAME_LENGTH, ENameTooLong);
  assert!(content_type.length() <= MAX_CONTENT_TYPE_LENGTH, EContentTypeTooLong);
  Entry { name, content_type, blob }
}

/// Return the entry's display name.
public fun get_name(entry: &Entry): String {
  entry.name
}

/// Return the entry's MIME content type metadata.
public fun get_content_type(entry: &Entry): String {
  entry.content_type
}

/// Return the referenced blob object ID.
public fun get_blob(entry: &Entry): ID {
  entry.blob
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
  let entry = new_entry(name, content_type, mock_blob.to_inner());

  assert_eq!(entry.name, name);
  assert_eq!(entry.content_type, content_type);
  assert_eq!(entry.blob, mock_blob.to_inner());

  unit_test::destroy(mock_blob);
  unit_test::destroy(entry);
}

#[test]
fun test_get_name() {
  let ctx = &mut tx_context::dummy();
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let blob = object::new(ctx);
  let entry = new_entry(name, content_type, blob.to_inner());

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
  let entry = new_entry(name, content_type, blob.to_inner());

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
  let entry = new_entry(name, content_type, blob.to_inner());

  assert_eq!(get_blob(&entry), blob.to_inner());

  unit_test::destroy(blob);
  unit_test::destroy(entry);
}

#[test]
#[expected_failure(abort_code = ENameEmpty)]
fun test_new_entry_empty_name_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let _entry = new_entry(b"".to_string(), b"application/json".to_string(), blob.to_inner());
  unit_test::destroy(blob);
}

#[test]
#[expected_failure(abort_code = EContentTypeEmpty)]
fun test_new_entry_empty_content_type_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let _entry = new_entry(b"title".to_string(), b"".to_string(), blob.to_inner());
  unit_test::destroy(blob);
}

#[test]
#[expected_failure(abort_code = ENameTooLong)]
fun test_new_entry_name_too_long_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let long_name = repeated_ascii_string(MAX_ENTRY_NAME_LENGTH + 1, 97);
  let _entry = new_entry(long_name, b"application/json".to_string(), blob.to_inner());
  unit_test::destroy(blob);
}

#[test]
#[expected_failure(abort_code = EContentTypeTooLong)]
fun test_new_entry_content_type_too_long_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let long_content_type = repeated_ascii_string(MAX_CONTENT_TYPE_LENGTH + 1, 97);
  let _entry = new_entry(b"title".to_string(), long_content_type, blob.to_inner());
  unit_test::destroy(blob);
}

#[test]
fun test_new_entry_max_boundary_lengths_succeed() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let max_name = repeated_ascii_string(MAX_ENTRY_NAME_LENGTH, 97);
  let max_content_type = repeated_ascii_string(MAX_CONTENT_TYPE_LENGTH, 98);
  let entry = new_entry(max_name, max_content_type, blob.to_inner());

  assert_eq!(get_name(&entry).length(), MAX_ENTRY_NAME_LENGTH);
  assert_eq!(get_content_type(&entry).length(), MAX_CONTENT_TYPE_LENGTH);

  unit_test::destroy(blob);
  unit_test::destroy(entry);
}
