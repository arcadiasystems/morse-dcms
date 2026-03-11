/// Module: publication.
/// A publication is a container for related collections of items.
/// It also acts as an entry point for the publication, allowing users to interact with the publication and its collections.
module publication::publication;

use std::string::String;
use sui::vec_map::{Self, VecMap};
use sui::event;

use publication::collection::{Self, Collection};

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

/// Delete a publication.
/// The collections vector must be empty, or an error will be thrown.
public fun delete_publication(publication: Publication) {
  let Publication{ id, name, collections } = publication;
  let publication_id = id.to_inner();

  collections.destroy_empty();
  id.delete();

  event::emit(PublicationDeleted {
    publication: publication_id,
    name,
  });
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

/// Remove and delete a collection from the publication.
/// The collection's content bag must be empty, or an error will be thrown.
public fun delete_collection(publication: &mut Publication, name: String) {
  let publication_id = object::id(publication);
  let (_, collection) = publication.collections.remove(&name);
  let collection_id = object::id(&collection);

  collection::delete_collection(collection);

  event::emit(CollectionRemoved {
    publication: publication_id,
    collection: collection_id,
    name,
  });
}

/// Event emitted when a new publication is created.
public struct PublicationCreated has copy, drop {
  publication: ID,
  name: String,
}

/// Event emitted when a publication is deleted.
public struct PublicationDeleted has copy, drop {
  publication: ID,
  name: String,
}

/// Event emitted when a new collection is added to a publication.
public struct CollectionAdded has copy, drop {
  publication: ID,
  collection: ID,
  name: String,
}

/// Event emitted when a collection is removed from a publication.
public struct CollectionRemoved has copy, drop {
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
fun test_delete_publication() {
  let ctx = &mut tx_context::dummy();
  let publication_name = b"ArcSys Blog".to_string();
  let publication = new_publication(ctx, publication_name);
  publication.delete_publication();
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

#[test]
fun test_delete_collection() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();

  let publication_name = b"ArcSys Blog".to_string();
  let mut publication = new_publication(ctx, publication_name);

  let collection_name = b"articles".to_string();
  let collection_type = b"article".to_string();
  let collection = new_collection(publication.id.to_inner(), collection_name, collection_type, ctx);

  publication.add_collection(collection);
  assert_eq!(publication.collections.length(), 1);

  publication.delete_collection(collection_name);
  assert_eq!(publication.collections.length(), 0);

  unit_test::destroy(publication);
}
