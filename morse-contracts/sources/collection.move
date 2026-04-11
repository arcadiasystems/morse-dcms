module publication::collection;

use std::string::String;
use sui::table::{Self, Table};
use publication::entry::Entry;

// -- Collection --

/// Storage mode: each entry references a standalone Walrus Blob by its Sui object ID.
/// Use for dynamic collections that grow over time (e.g. articles, posts).
const STORAGE_MODE_BLOB: u8 = 0;

/// Storage mode: entries are patches within a shared Walrus Quilt blob, referenced by QuiltPatchId.
/// Use for small, rarely-changing collections (e.g. website content, config JSONs).
const STORAGE_MODE_QUILT: u8 = 1;

/// Error code: no entry exists for the requested `entry_id`.
const EEntryNotFound: u64 = 0;

/// Error code: storage mode must be STORAGE_MODE_BLOB (0) or STORAGE_MODE_QUILT (1).
const EInvalidStorageMode: u64 = 1;

/// A collection belonging to a publication.
public struct Collection has store {
  name: String,
  /// Determines how entry blob references are stored and retrieved.
  /// STORAGE_MODE_BLOB (0): each entry has a standalone Walrus Blob ID.
  /// STORAGE_MODE_QUILT (1): entries are patches in a shared quilt blob, addressed by QuiltPatchId.
  /// Immutable after creation.
  storage_mode: u8,
  /// Next monotonic ID used when inserting into `entries`.
  next_entry_id: u64,
  /// Entries keyed by stable monotonic `entry_id` values.
  entries: Table<u64, Entry>,
}

/// Create a new empty collection with the given name and storage mode.
/// `storage_mode` must be `STORAGE_MODE_BLOB` (0) or `STORAGE_MODE_QUILT` (1).
public(package) fun new_collection(name: String, storage_mode: u8, ctx: &mut TxContext): Collection {
  assert!(storage_mode == STORAGE_MODE_BLOB || storage_mode == STORAGE_MODE_QUILT, EInvalidStorageMode);
  Collection {
    name,
    storage_mode,
    next_entry_id: 0,
    entries: table::new(ctx),
  }
}

/// Delete a collection.
/// The entries table must be empty, or an error will be thrown.
public(package) fun delete_collection(collection: Collection) {
  let Collection { name: _, storage_mode: _, next_entry_id: _, entries } = collection;
  table::destroy_empty(entries);
}

public fun get_name(collection: &Collection): String {
  collection.name
}

/// Return the storage mode for this collection: STORAGE_MODE_BLOB (0) or STORAGE_MODE_QUILT (1).
public fun get_storage_mode(collection: &Collection): u8 {
  collection.storage_mode
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

/// Return the STORAGE_MODE_BLOB constant value for use in tests outside this module.
#[test_only]
public(package) fun storage_mode_blob(): u8 { STORAGE_MODE_BLOB }

/// Return the STORAGE_MODE_QUILT constant value for use in tests outside this module.
#[test_only]
public(package) fun storage_mode_quilt(): u8 { STORAGE_MODE_QUILT }

// internal
public(package) fun get_entry_mut(collection: &mut Collection, entry_id: u64): &mut Entry {
  assert!(collection.entries.contains(entry_id), EEntryNotFound);
  collection.entries.borrow_mut(entry_id)
}
