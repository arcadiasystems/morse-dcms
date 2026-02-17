module publication::collection;

use std::string::String;

/// A collection belonging to a publication.
public struct Collection has store, key {
  id: UID,
  publication_id: ID,
  name: String,
  collection_type: String,
}

public fun get_name(collection: &Collection): String {
  collection.name
}

public fun new_collection(publication_id: ID, name: String, collection_type: String, ctx: &mut TxContext): Collection {
  let collection = Collection {
    id: object::new(ctx),
    publication_id,
    name,
    collection_type,
  };
  collection
}

#[test_only]
use std::unit_test;

#[test_only]
use std::unit_test::assert_eq;

#[test]
fun test_new_collection(){
  let ctx = &mut tx_context::dummy();

  let mock_publication_id = object::new(ctx);

  let collection = new_collection(
    mock_publication_id.to_inner(),
    b"articles".to_string(),
    b"article".to_string(),
     ctx
  );

  assert_eq!(collection.publication_id, mock_publication_id.to_inner());
  assert_eq!(collection.name, b"articles".to_string());
  assert_eq!(collection.collection_type, b"article".to_string());

  unit_test::destroy(mock_publication_id);
  unit_test::destroy(collection);
}
