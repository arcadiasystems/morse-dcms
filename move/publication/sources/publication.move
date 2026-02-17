/// Module: publication.
/// A publication is a container for related collections of items.
/// It also acts as an entry point for the publication, allowing users to interact with the publication and its collections.
module publication::publication;

use std::string::String;
use sui::vec_map::{Self, VecMap};
use sui::event;

use publication::collection::Collection;

/// A publication. Can be managed by the owner and shared with others.
/// The publication contains zero or more collections of items that are stored in decentralized storage.
public struct Publication has key, store {
  id: UID,
  name: String,
  collections: VecMap<String, Collection>,
}

/// Create a new publication.
/// By default, the publication is empty and can be managed by the admin.
public fun new_publication(ctx: &mut TxContext, name: String): Publication {
  let publication = Publication {
    id: object::new(ctx),
    name,
    collections: vec_map::empty(),
  };


  event::emit(PublicationCreated {
    publication: object::id(&publication),
    name,
  });

  publication
}

/// Add a new collection to the publication.
public fun add_collection(publication: &mut Publication, collection: Collection) {
  let publication_id = object::id(publication);
  let collection_id = object::id(&collection);
  let collection_name = collection.get_name();

  publication.collections.insert(collection_name, collection);

  event::emit(CollectionAdded {
    publication: publication_id,
    collection: collection_id,
    name: collection_name,
  });
}

/// Event emitted when a new publication is created.
public struct PublicationCreated has copy, drop {
  publication: ID,
  name: String,
}

/// Event emitted when a new collection is added to a publication.
public struct CollectionAdded has copy, drop {
  publication: ID,
  collection: ID,
  name: String,
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
