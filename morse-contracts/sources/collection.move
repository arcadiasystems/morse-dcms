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
  let index = collection.content.length();
  collection.content.add(index, content)
}

/// Delete a content from the collection.
/// Content has drop trait, so it will be destroyed when removed from the collection.
public fun delete_content(collection: &mut Collection, index: u64) {
  collection.content.remove<u64, Content>(index);
}

/// Delete a collection.
/// The content bag must be empty, or an error will be thrown.
public fun delete_collection(collection: Collection) {
  let Collection { id, publication_id: _, name: _, collection_type: _, content } = collection;
  content.destroy_empty();
  id.delete();
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
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let blob_id = 1234;
  let content = new_content(
    name,
    content_type,
    blob_id,
  );

  // Add the content to the collection
  collection.add_content(content);

  // Check if the collection contains the content
  let index: u64 = 0;
  assert_eq!(collection.content.contains(index), true);

  unit_test::destroy(mock_publication_id);
  unit_test::destroy(collection);
}

#[test]
fun test_delete_content() {
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
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let blob_id = 1234;
  let content = new_content(
    name,
    content_type,
    blob_id,
  );

  // Add the content to the collection
  collection.add_content(content);

  // Sanity check if the collection contains the content
  let index: u64 = 0;
  assert_eq!(collection.content.contains(index), true);

  // Now delete it
  collection.delete_content(index);

  // Check if the collection is empty
  assert_eq!(collection.content.length(), 0);

  unit_test::destroy(mock_publication_id);
  unit_test::destroy(collection);
}
