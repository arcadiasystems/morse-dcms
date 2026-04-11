module publication::collection;

use std::string::String;
use sui::table::{Self, Table};
use publication::entry::Entry;

// -- Collection --

/// Error code: no entry exists for the requested `entry_id`.
const EEntryNotFound: u64 = 0;

/// A collection belonging to a publication.
public struct Collection has store {
  name: String,
  /// Next monotonic ID used when inserting into `entries`.
  next_entry_id: u64,
  /// Entries keyed by stable monotonic `entry_id` values.
  entries: Table<u64, Entry>,
}

/// Create a new empty collection with the given name.
public(package) fun new_collection(name: String, ctx: &mut TxContext): Collection {
  Collection {
    name,
    next_entry_id: 0,
    entries: table::new(ctx),
  }
}

/// Delete a collection.
/// The entries table must be empty, or an error will be thrown.
public(package) fun delete_collection(collection: Collection) {
  let Collection { name: _, next_entry_id: _, entries } = collection;
  table::destroy_empty(entries);
}

public fun get_name(collection: &Collection): String {
  collection.name
}

public fun entries_length(collection: &Collection): u64 {
  collection.entries.length()
}

/// Add an entry to the collection. Returns the stable `entry_id` assigned to it.
/// IDs are monotonically increasing and stable across deletions (holes are expected).
public(package) fun add_entry(collection: &mut Collection, entry: Entry): u64 {
  let entry_id = collection.next_entry_id;
  collection.entries.add(entry_id, entry);
  collection.next_entry_id = entry_id + 1;
  entry_id
}

/// Delete an entry from the collection.
/// `Entry` has the `drop` ability so it is destroyed on removal.
public(package) fun delete_entry(collection: &mut Collection, entry_id: u64) {
  assert!(collection.entries.contains(entry_id), EEntryNotFound);
  collection.entries.remove(entry_id);
}

#[test_only]
public(package) fun contains_entry(collection: &Collection, entry_id: u64): bool {
  collection.entries.contains(entry_id)
}

#[test_only]
public(package) fun next_entry_id(collection: &Collection): u64 {
  collection.next_entry_id
}

// internal
public(package) fun get_entry_mut(collection: &mut Collection, entry_id: u64): &mut Entry {
  assert!(collection.entries.contains(entry_id), EEntryNotFound);
  collection.entries.borrow_mut(entry_id)
}
