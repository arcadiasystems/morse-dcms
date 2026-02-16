/// Module: publication
module publication::publication;

use std::string::String;
use sui::vec_map::{Self, VecMap};

/// A publication. Can be managed by the owner and shared with others.
/// The publication contains zero or more collections of items that are stored in decentralized storage.
public struct Publication has key, store {
  id: UID,
  name: String,
  collections: VecMap<String, Collection>,
}

/// Create a new publication.
public fun new_publication(ctx: &mut TxContext, name: String): Publication {
  let publication = Publication {
    id: object::new(ctx),
    name,
    collections: vec_map::empty(),
  };
  publication
}

/// Add a new collection to the publication.
public fun add_collection(publication: &mut Publication, name: String, collection_type: String, ctx: &mut TxContext) {
  let collection = new_collection(ctx, object::id(publication), name, collection_type);
  publication.collections.insert(name, collection);
}

/// Set the blob ID for a collection.
/// The user first creates an empty collection, than he uploads the data (in a separate transaction) to the decentralized storage and then calls this method to set the blob ID.
public fun set_collection_blob_id(publication: &mut Publication, name: &mut String, blob_id: u256) {
  let collection = publication.collections.get_mut(name);
  collection.blob_id = option::some(blob_id);
}

/// A collection belonging to a publication.
public struct Collection has key, store {
  id: UID,
  publication_id: ID,
  name: String,
  collection_type: String,
  blob_id: Option<u256>,
}

public fun new_collection(ctx: &mut TxContext, publication_id: ID, name: String, collection_type: String): Collection {
  let collection = Collection {
    id: object::new(ctx),
    publication_id,
    name,
    collection_type,
    blob_id: option::none(),
  };
  collection
}

public fun hello_world(): String {
  b"Hello, World!".to_string()
}

#[test_only]
use std::unit_test::assert_eq;
use std::unit_test;

#[test]
fun test_hello_world() {
  assert_eq!(hello_world(), b"Hello, World!".to_string());
}

#[test]
fun test_new_publication() {
  let ctx = &mut tx_context::dummy();
  let publication_name = b"ArcSys Blog".to_string();

  let publication = new_publication(ctx, publication_name);

  assert_eq!(publication.name, publication_name);

  unit_test::destroy(publication);
}

#[test]
fun test_new_publication_ownership() {
  use sui::test_scenario;
  let creator = @0xA;

  let mut scenario = test_scenario::begin(creator);

  let ctx = scenario.ctx();
  let publication = new_publication(ctx, b"ArcSys Blog".to_string());
  transfer::transfer(publication, scenario.sender());

  scenario.next_tx(creator);
  {
    let created = scenario.take_from_sender<Publication>();
    // assert_eq!(created.id, publication.id);
    scenario.return_to_sender(created);
  };

  // unit_test::destroy(publication);
  test_scenario::end(scenario);
}

#[test]
fun test_add_collection() {
  let ctx = &mut tx_context::dummy();
  let mut publication = new_publication(ctx, b"ArcSys Blog".to_string());
  let collection_name = b"articles".to_string();
  let collection_type = b"article".to_string();
  add_collection(&mut publication, collection_name, collection_type, ctx);
  assert_eq!(publication.collections.length(), 1);

  assert_eq!(publication.collections.contains(&collection_name), true);

  unit_test::destroy(publication);
}

#[test]
fun test_set_collection_blob_id() {
  let ctx = &mut tx_context::dummy();
  let mut publication = new_publication(ctx, b"ArcSys Blog".to_string());
  let mut collection_name = b"articles".to_string();
  let collection_type = b"article".to_string();
  add_collection(&mut publication, collection_name, collection_type, ctx);
  assert_eq!(publication.collections.length(), 1);

  set_collection_blob_id(&mut publication, &mut collection_name, 1234567890);
  // assert_eq!(publication.collections.get(collection_name).blob_id, option::some(1234567890));

  unit_test::destroy(publication);
}
