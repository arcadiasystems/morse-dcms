module publication::collection;

use std::string::String;
use sui::table::{Self, Table};
use publication::entry::Entry;

// --- Constants ---

// --- Error codes ---

/// Error code: no entry exists for the requested `entry_id`.
const EEntryNotFound: u64 = 0;

// --- Data structures ---

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

// --- Public API ---

public(package) fun new_collection(publication_id: ID, name: String, ctx: &mut TxContext): Collection {
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

#[test_only]
public(package) fun contains_entry(collection: &Collection, entry_id: u64): bool {
  collection.entries.contains(entry_id)
}

#[test_only]
public(package) fun next_entry_id(collection: &Collection): u64 {
  collection.next_entry_id
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

public(package) fun get_entry_mut(collection: &mut Collection, entry_id: u64): &mut Entry {
  assert!(collection.entries.contains(entry_id), EEntryNotFound);
  collection.entries.borrow_mut(entry_id)
}

/// Delete a collection.
/// The entries table must be empty, or an error will be thrown.
public fun delete_collection(collection: Collection) {
  let Collection { id, publication_id: _, name: _, next_entry_id: _, entries } = collection;
  table::destroy_empty(entries);
  id.delete();
}
