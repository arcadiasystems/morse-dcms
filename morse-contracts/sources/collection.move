module publication::collection;

use std::string::String;
use sui::table::{Self, Table};
use publication::entry::Entry;

/// A collection belonging to a publication.
public struct Collection has store, key {
  id: UID,
  publication_id: ID,
  name: String,
  entries: Table<u64, Entry>,
}

public fun new_collection(publication_id: ID, name: String, ctx: &mut TxContext): Collection {
  let collection = Collection {
    id: object::new(ctx),
    publication_id,
    name,
    entries: table::new(ctx),
  };
  collection
}

public fun get_name(collection: &Collection): String {
  collection.name
}

public fun add_entry(collection: &mut Collection, entry: Entry) {
  let index = collection.entries.length();
  collection.entries.add(index, entry)
}

/// Delete an entry from the collection.
/// Entry has drop trait, so it will be destroyed when removed from the collection.
public fun delete_entry(collection: &mut Collection, index: u64) {
  collection.entries.remove(index);
}

/// Delete a collection.
/// The entries table must be empty, or an error will be thrown.
public fun delete_collection(collection: Collection) {
  let Collection { id, publication_id: _, name: _, entries } = collection;
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
  let blob_id = 1234;
  let entry = new_entry(
    name,
    entry_type,
    blob_id,
  );

  // Add the entry to the collection
  collection.add_entry(entry);

  // Check if the collection contains the entry
  let index: u64 = 0;
  assert_eq!(collection.entries.contains(index), true);

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
  let blob_id = 1234;
  let entry = new_entry(
    name,
    entry_type,
    blob_id,
  );

  // Add the entry to the collection
  collection.add_entry(entry);

  // Sanity check
  let index: u64 = 0;
  assert_eq!(collection.entries.contains(index), true);

  // Now delete it
  collection.delete_entry(index);

  // Check if the collection is empty
  assert_eq!(collection.entries.length(), 0);

  unit_test::destroy(mock_publication_id);
  unit_test::destroy(collection);
}
