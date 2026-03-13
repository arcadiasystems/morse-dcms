/// Module: publication.
/// A publication is a root container for your content.
/// It also acts as an entry point for the publication, allowing users to interact with the publication and its content.
module publication::publication;

use std::string::String;
use sui::vec_map::{Self, VecMap};
use sui::event;

use publication::collection::{Self, Collection};
use publication::singleton::{Self, Singleton};

/// Root object that must be created before any collections or content can be added.
/// A publication groups related collections and acts as the entry point for all interactions.
/// Collections and singletons are wrapped inside the publication and are only accessible through it.
///
/// Authorization is enforced through native Sui object ownership: only the owner of this object
/// can pass it as a mutable argument, so no explicit capability checks are needed.
/// This guarantee holds only while the publication remains an owned object — do not share it
/// via `transfer::share_object`, as that would allow anyone to mutate it.
public struct Publication has key, store {
  id: UID,
  name: String,
  collections: VecMap<String, Collection>,
  singletons: VecMap<String, Singleton>,
}

/// Create a new publication.
/// By default, the publication is empty and can be managed by the owner only.
public fun new_publication(ctx: &mut TxContext, name: String): Publication {
  let publication = Publication {
    id: object::new(ctx),
    name,
    collections: vec_map::empty(),
    singletons: vec_map::empty(),
  };

  event::emit(PublicationCreated {
    publication: object::id(&publication),
    name,
  });

  publication
}

/// Delete a publication.
/// The collections and singletons vectors must be empty, or an error will be thrown.
public fun delete_publication(publication: Publication) {
  let Publication{ id, name, collections, singletons } = publication;
  let publication_id = id.to_inner();

  collections.destroy_empty();
  singletons.destroy_empty();
  id.delete();

  event::emit(PublicationDeleted {
    publication: publication_id,
    name,
  });
}

/// Error code: a collection with the given name already exists in the publication.
const ECollectionAlreadyExists: u64 = 0;

/// Error code: a singleton with the given name already exists in the publication.
const ESingletonAlreadyExists: u64 = 1;

/// Add a new collection to the publication.
/// Aborts with `ECollectionAlreadyExists` if a collection with the same name already exists.
public fun add_collection(publication: &mut Publication, collection: Collection) {
  let publication_id = object::id(publication);
  let collection_id = object::id(&collection);
  let collection_name = collection.get_name();

  assert!(!publication.collections.contains(&collection_name), ECollectionAlreadyExists);
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

/// Add a new singleton to the publication.
public fun add_singleton(publication: &mut Publication, singleton: Singleton) {
  let publication_id = object::id(publication);
  let singleton_id = object::id(&singleton);
  let singleton_name = singleton.get_name();

  assert!(!publication.singletons.contains(&singleton_name), ESingletonAlreadyExists);
  publication.singletons.insert(singleton_name, singleton);

  event::emit(SingletonAdded {
    publication: publication_id,
    singleton: singleton_id,
    name: singleton_name,
  });
}

/// Remove and delete a singleton from the publication.
public fun delete_singleton(publication: &mut Publication, name: String) {
  let publication_id = object::id(publication);
  let (_, singleton) = publication.singletons.remove(&name);
  let singleton_id = object::id(&singleton);

  singleton::delete_singleton(singleton);

  event::emit(SingletonRemoved {
    publication: publication_id,
    singleton: singleton_id,
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

/// Event emitted when a new singleton is added to a publication.
public struct SingletonAdded has copy, drop {
  publication: ID,
  singleton: ID,
  name: String,
}

/// Event emitted when a singleton is removed from a publication.
public struct SingletonRemoved has copy, drop {
  publication: ID,
  singleton: ID,
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
#[expected_failure(abort_code = ECollectionAlreadyExists)]
fun test_add_duplicate_collection() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();

  let mut publication = new_publication(ctx, b"ArcSys Blog".to_string());
  let collection = new_collection(publication.id.to_inner(), b"articles".to_string(), b"article".to_string(), ctx);
  let duplicate = new_collection(publication.id.to_inner(), b"articles".to_string(), b"article".to_string(), ctx);

  publication.add_collection(collection);
  publication.add_collection(duplicate);

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

#[test]
fun test_add_singleton() {
  use publication::singleton::new_singleton;

  let ctx = &mut tx_context::dummy();

  let publication_name = b"ArcSys Blog".to_string();
  let mut publication = new_publication(ctx, publication_name);

  let mock_blob_id = object::new(ctx);
  let singleton = new_singleton(publication.id.to_inner(), b"cover".to_string(), mock_blob_id.to_inner(), ctx);

  publication.add_singleton(singleton);

  assert_eq!(publication.singletons.length(), 1);
  assert_eq!(publication.singletons.contains(&b"cover".to_string()), true);

  unit_test::destroy(mock_blob_id);
  unit_test::destroy(publication);
}

#[test]
#[expected_failure(abort_code = ESingletonAlreadyExists)]
fun test_add_duplicate_singleton() {
  use publication::singleton::new_singleton;

  let ctx = &mut tx_context::dummy();

  let mut publication = new_publication(ctx, b"ArcSys Blog".to_string());

  let blob_id_1 = object::new(ctx);
  let blob_id_2 = object::new(ctx);
  let singleton = new_singleton(publication.id.to_inner(), b"cover".to_string(), blob_id_1.to_inner(), ctx);
  let duplicate = new_singleton(publication.id.to_inner(), b"cover".to_string(), blob_id_2.to_inner(), ctx);

  publication.add_singleton(singleton);
  publication.add_singleton(duplicate);

  unit_test::destroy(blob_id_1);
  unit_test::destroy(blob_id_2);
  unit_test::destroy(publication);
}

#[test]
fun test_delete_singleton() {
  use publication::singleton::new_singleton;

  let ctx = &mut tx_context::dummy();

  let publication_name = b"ArcSys Blog".to_string();
  let mut publication = new_publication(ctx, publication_name);

  let mock_blob_id = object::new(ctx);
  let singleton = new_singleton(publication.id.to_inner(), b"cover".to_string(), mock_blob_id.to_inner(), ctx);

  publication.add_singleton(singleton);
  assert_eq!(publication.singletons.length(), 1);

  publication.delete_singleton(b"cover".to_string());
  assert_eq!(publication.singletons.length(), 0);

  unit_test::destroy(mock_blob_id);
  unit_test::destroy(publication);
}
