module publication::entry;

use std::string::String;

/// An entry belonging to a collection or a named singleton in a publication.
/// Holds a reference to an existing on-chain Walrus Blob object by its ID.
/// The blob is not wrapped — it remains an independent object and can be
/// replaced by removing this entry and inserting a new one.
public struct Entry has store, drop {
  name: String,
  entry_type: String,
  blob: ID,
}

public fun new_entry(name: String, entry_type: String, blob: ID): Entry {
  Entry { name, entry_type, blob }
}

public fun get_name(entry: &Entry): String {
  entry.name
}

public fun get_blob(entry: &Entry): ID {
  entry.blob
}

#[test_only]
use std::unit_test;

#[test_only]
use std::unit_test::assert_eq;

#[test]
fun test_new_entry() {
  let ctx = &mut tx_context::dummy();

  let name = b"First Blog Post".to_string();
  let entry_type = b"application/json".to_string();
  let mock_blob = object::new(ctx);
  let entry = new_entry(name, entry_type, mock_blob.to_inner());

  assert_eq!(entry.entry_type, entry_type);
  assert_eq!(entry.blob, mock_blob.to_inner());

  unit_test::destroy(mock_blob);
  unit_test::destroy(entry);
}
