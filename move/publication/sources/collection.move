module publication::collection;

use std::string::String;
use sui::bag::{Self, Bag};
use publication::content::Content;

/// A collection belonging to a publication.
public struct Collection has store, key {
  id: UID,
  publication_id: ID,
  name: String,
  collection_type: String,
  content: Bag,
}

public fun new_collection(publication_id: ID, name: String, collection_type: String, ctx: &mut TxContext): Collection {
  let collection = Collection {
    id: object::new(ctx),
    publication_id,
    name,
    collection_type,
    content: bag::new(ctx),
  };
  collection
}

public fun get_name(collection: &Collection): String {
  collection.name
}

public fun add_content(collection: &mut Collection, content: Content) {
  collection.content.add(content.get_address(), content)
}

#[test_only]
use std::unit_test;

#[test_only]
use std::unit_test::assert_eq;

#[test_only]
use publication::content::new_content;

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

#[test]
fun test_add_content() {
  let ctx = &mut tx_context::dummy();

  let mock_publication_id = object::new(ctx);

  // Create a collection
  let mut collection = new_collection(
    mock_publication_id.to_inner(),
    b"articles".to_string(),
    b"article".to_string(),
     ctx
  );

  // Create some content
  let content_type = b"article".to_string();
  let blob_id = 1234;
  let content = new_content(content_type, blob_id, ctx);

  // Add the content to the collection
  let content_address = content.get_address();
  add_content(&mut collection, content);

  // Check if the collection contains the content
  assert_eq!(collection.content.contains(content_address), true);

  unit_test::destroy(mock_publication_id);
  unit_test::destroy(collection);
}
