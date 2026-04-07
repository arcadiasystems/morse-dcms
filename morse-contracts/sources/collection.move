module publication::collection;

use std::string::String;
use sui::table::{Self, Table};
use publication::entry::Entry;

/// Error code: no entry exists for the requested `entry_id`.
const EEntryNotFound: u64 = 0;

/// A collection belonging to a publication.
public struct Collection has store, key {
  id: UID,
  publication_id: ID,
  name: String,
  /// Next monotonic ID used when inserting into `entries`.
  next_entry_id: u64,
  /// Entries keyed by stable monotonic `entry_id` values.
  entries: Table<u64, Entry>,
}

public fun new_collection(publication_id: ID, name: String, ctx: &mut TxContext): Collection {
  let collection = Collection {
    id: object::new(ctx),
    publication_id,
    name,
    next_entry_id: 0,
    entries: table::new(ctx),
  };
  collection
}

public fun get_name(collection: &Collection): String {
  collection.name
}

public fun get_publication_id(collection: &Collection): ID {
  collection.publication_id
}

public fun entries_length(collection: &Collection): u64 {
  collection.entries.length()
}

public fun add_entry(collection: &mut Collection, entry: Entry): u64 {
  // Keep IDs monotonic and stable across deletions (holes are expected).
  let entry_id = collection.next_entry_id;
  collection.entries.add(entry_id, entry);
  collection.next_entry_id = entry_id + 1;
  entry_id
}

/// Delete an entry from the collection.
/// Entry has drop trait, so it will be destroyed when removed from the collection.
public fun delete_entry(collection: &mut Collection, entry_id: u64) {
  assert!(collection.entries.contains(entry_id), EEntryNotFound);
  collection.entries.remove(entry_id);
}

/// Delete a collection.
/// The entries table must be empty, or an error will be thrown.
public fun delete_collection(collection: Collection) {
  let Collection { id, publication_id: _, name: _, next_entry_id: _, entries } = collection;
  table::destroy_empty(entries);
  id.delete();
}

#[test_only]
use std::unit_test;

#[test_only]
use std::unit_test::assert_eq;

#[test_only]
use publication::entry::new_entry;

#[test]
fun test_new_collection(){
  let ctx = &mut tx_context::dummy();

  let mock_publication_id = object::new(ctx);

  let collection = new_collection(
    mock_publication_id.to_inner(),
    b"articles".to_string(),
    ctx
  );

  assert_eq!(collection.publication_id, mock_publication_id.to_inner());
  assert_eq!(collection.name, b"articles".to_string());
  assert_eq!(collection.next_entry_id, 0);

  unit_test::destroy(mock_publication_id);
  unit_test::destroy(collection);
}

#[test]
fun test_add_entry() {
  let ctx = &mut tx_context::dummy();

  let mock_publication_id = object::new(ctx);

  // Create a collection
  let mut collection = new_collection(
    mock_publication_id.to_inner(),
    b"articles".to_string(),
    ctx
  );

  // Create an entry
  let name = b"First Blog Post".to_string();
  let entry_type = b"application/json".to_string();
  let mock_blob = object::new(ctx);
  let entry = new_entry(name, entry_type, mock_blob.to_inner());

  // Add the entry to the collection
  let entry_id = collection.add_entry(entry);

  // Check if the collection contains the entry
  assert_eq!(entry_id, 0);
  assert_eq!(collection.entries.contains(entry_id), true);
  assert_eq!(collection.next_entry_id, 1);

  unit_test::destroy(mock_blob);
  unit_test::destroy(mock_publication_id);
  unit_test::destroy(collection);
}

#[test]
fun test_delete_entry() {
  let ctx = &mut tx_context::dummy();

  let mock_publication_id = object::new(ctx);

  // Create a collection
  let mut collection = new_collection(
    mock_publication_id.to_inner(),
    b"articles".to_string(),
    ctx
  );

  // Create an entry
  let name = b"First Blog Post".to_string();
  let entry_type = b"application/json".to_string();
  let mock_blob = object::new(ctx);
  let entry = new_entry(name, entry_type, mock_blob.to_inner());

  // Add the entry to the collection
  let entry_id = collection.add_entry(entry);

  // Sanity check
  assert_eq!(entry_id, 0);
  assert_eq!(collection.entries.contains(entry_id), true);

  // Now delete it
  collection.delete_entry(entry_id);

  // Check if the collection is empty
  assert_eq!(collection.entries.length(), 0);

  unit_test::destroy(mock_blob);
  unit_test::destroy(mock_publication_id);
  unit_test::destroy(collection);
}

#[test]
fun test_delete_then_add_uses_monotonic_entry_id() {
  let ctx = &mut tx_context::dummy();

  let mock_publication_id = object::new(ctx);
  let mut collection = new_collection(mock_publication_id.to_inner(), b"articles".to_string(), ctx);

  let blob_0 = object::new(ctx);
  let blob_1 = object::new(ctx);
  let blob_2 = object::new(ctx);
  let blob_3 = object::new(ctx);

  let first_id = collection.add_entry(new_entry(b"a".to_string(), b"application/json".to_string(), blob_0.to_inner()));
  let second_id = collection.add_entry(new_entry(b"b".to_string(), b"application/json".to_string(), blob_1.to_inner()));
  let third_id = collection.add_entry(new_entry(b"c".to_string(), b"application/json".to_string(), blob_2.to_inner()));

  collection.delete_entry(second_id);

  let fourth_id = collection.add_entry(new_entry(b"d".to_string(), b"application/json".to_string(), blob_3.to_inner()));

  assert_eq!(collection.entries.length(), 3);
  assert_eq!(first_id, 0);
  assert_eq!(second_id, 1);
  assert_eq!(third_id, 2);
  assert_eq!(fourth_id, 3);
  assert_eq!(collection.entries.contains(first_id), true);
  assert_eq!(collection.entries.contains(second_id), false);
  assert_eq!(collection.entries.contains(third_id), true);
  assert_eq!(collection.entries.contains(fourth_id), true);
  assert_eq!(collection.next_entry_id, 4);

  unit_test::destroy(blob_0);
  unit_test::destroy(blob_1);
  unit_test::destroy(blob_2);
  unit_test::destroy(blob_3);
  unit_test::destroy(mock_publication_id);
  unit_test::destroy(collection);
}

#[test]
#[expected_failure(abort_code = EEntryNotFound)]
fun test_delete_missing_entry_id_fails() {
  let ctx = &mut tx_context::dummy();

  let mock_publication_id = object::new(ctx);
  let mut collection = new_collection(mock_publication_id.to_inner(), b"articles".to_string(), ctx);

  collection.delete_entry(42);

  unit_test::destroy(mock_publication_id);
  unit_test::destroy(collection);
}
