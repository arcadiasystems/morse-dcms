module publication::entry;

use std::string::String;

/// An entry belonging to a collection.
/// The entry data is stored in decentralized storage and accessed via a blob_id.
public struct Entry has store, drop {
  name: String,
  entry_type: String,
  blob_id: u256,
}

public fun new_entry(name: String, entry_type: String, blob_id: u256): Entry {
  let entry = Entry {
    name,
    entry_type,
    blob_id,
  };
  entry
}

#[test_only]
use std::unit_test;

#[test_only]
use std::unit_test::assert_eq;

#[test]
fun test_new_entry() {
  let name = b"First Blog Post".to_string();
  let entry_type = b"application/json".to_string();
  let blob_id = 1234;
  let entry = new_entry(
    name,
    entry_type,
    blob_id,
  );

  assert_eq!(entry.entry_type, entry_type);

  unit_test::destroy(entry);
}
