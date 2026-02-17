/// Module: publication
module publication::publication;

use std::string::String;
use sui::vec_map::{Self, VecMap};

use publication::collection::Collection;

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
public fun add_collection(publication: &mut Publication, collection: Collection) {
  publication.collections.insert(collection.get_name(), collection);
}

#[test_only]
use std::unit_test;

#[test_only]
use std::unit_test::assert_eq;

#[test]
fun test_new_publication() {
  let ctx = &mut tx_context::dummy();
  let publication_name = b"ArcSys Blog".to_string();

  // Create a publication
  let publication = new_publication(ctx, publication_name);

  assert_eq!(publication.name, publication_name);

  unit_test::destroy(publication);
}

#[test]
fun test_add_collection() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();

  // Create a publication
  let publication_name = b"ArcSys Blog".to_string();
  let mut publication = new_publication(ctx, publication_name);

  // Create a collection
  let collection_name = b"articles".to_string();
  let collection_type = b"article".to_string();
  let collection = new_collection(publication.id.to_inner(), collection_name, collection_type, ctx);

  // Add the collection to the publication
  publication.add_collection(collection);

  // Check if the collection was added
  assert_eq!(publication.collections.length(), 1);
  assert_eq!(publication.collections.contains(&collection_name), true);

  unit_test::destroy(publication);
}
