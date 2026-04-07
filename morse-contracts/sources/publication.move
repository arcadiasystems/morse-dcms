/// Module: publication.
/// A publication is a root container for your content.
/// It also acts as an entry point for the publication, allowing users to interact with the publication and its content.
module publication::publication;

use std::string::String;
use sui::vec_map::{Self, VecMap};
use sui::table::{Self, Table};
use sui::event;

use publication::collection::{Self, Collection};
use publication::entry::Entry;

/// Root container for a publication's collections and singletons.
/// Created as a shared object so both the owner and issued publishers can interact with it.
/// All mutations require a valid PublisherCap or OwnerCap tied to this publication's ID.
///
/// `collections` uses `VecMap` because a publication is expected (and a *best practice*) to have only a few collections.
/// Root `singletons` and collection entries use `Table` because they can be numerous.
public struct Publication has key, store {
  id: UID,
  name: String,
  // TODO: Should I add a 'slug' property? How do we guarantee slug uniqueness?
  collections: VecMap<String, Collection>,
  singletons: Table<String, Entry>,
}

/// Proves ownership of a publication.
/// Required to issue PublisherCaps and delete the publication. Only one exists per publication.
/// `key` only (no `store`) — cannot be publicly re-transferred.
public struct OwnerCap has key {
  id: UID,
  publication_id: ID,
}

/// Grants write access to a publication.
/// Issued by the owner via `issue_publisher_cap`. Multiple can exist per publication.
/// `key` only (no `store`) — cannot be publicly re-transferred.
public struct PublisherCap has key {
  id: UID,
  publication_id: ID,
}

/// Error code: a collection with the given name already exists in the publication.
const ECollectionAlreadyExists: u64 = 0;

/// Error code: a singleton with the given name already exists in the publication.
const ESingletonAlreadyExists: u64 = 1;

/// Error code: the capability does not belong to this publication.
const EUnauthorized: u64 = 2;

/// Create a new publication.
/// The publication is shared so publishers can interact with it.
/// An OwnerCap and a PublisherCap are transferred to the caller.
public fun new_publication(ctx: &mut TxContext, name: String) {
  let (publication, owner_cap, publisher_cap) = create_publication(ctx, name);
  transfer::share_object(publication);
  transfer::transfer(owner_cap, ctx.sender());
  transfer::transfer(publisher_cap, ctx.sender());
}

/// Delete a publication. Requires the OwnerCap; both are consumed.
/// All collections and singletons must be removed first, or this will abort.
public fun delete_publication(publication: Publication, owner_cap: OwnerCap) {
  assert!(owner_cap.publication_id == object::id(&publication), EUnauthorized);

  let OwnerCap { id: cap_id, publication_id: _ } = owner_cap;
  cap_id.delete();

  let Publication { id, name, collections, singletons } = publication;
  let publication_id = id.to_inner();

  collections.destroy_empty();
  singletons.destroy_empty();
  id.delete();

  event::emit(PublicationDeleted { publication: publication_id, name });
}

/// Issue a new PublisherCap for this publication. Only callable by the owner.
/// The returned cap should be transferred to the intended publisher.
public fun issue_publisher_cap(
  publication: &Publication,
  owner_cap: &OwnerCap,
  ctx: &mut TxContext,
): PublisherCap {
  assert!(owner_cap.publication_id == object::id(publication), EUnauthorized);
  let cap = PublisherCap { id: object::new(ctx), publication_id: object::id(publication) };
  event::emit(PublisherCapIssued { publication: object::id(publication), cap: object::id(&cap) });
  cap
}

/// Destroy a PublisherCap, voluntarily revoking write access.
public fun destroy_publisher_cap(cap: PublisherCap) {
  let PublisherCap { id, publication_id: _ } = cap;
  id.delete();
}

/// Add a new collection to the publication.
/// Aborts with `ECollectionAlreadyExists` if a collection with the same name already exists.
public fun add_collection(publication: &mut Publication, cap: &PublisherCap, collection: Collection) {
  assert!(cap.publication_id == object::id(publication), EUnauthorized);

  let publication_id = object::id(publication);
  let collection_id = object::id(&collection);
  let collection_name = collection.get_name();

  assert!(!publication.collections.contains(&collection_name), ECollectionAlreadyExists);
  publication.collections.insert(collection_name, collection);

  event::emit(CollectionAdded { publication: publication_id, collection: collection_id, name: collection_name });
}

/// Remove and delete a collection from the publication.
/// The collection's entries table must be empty, or this will abort.
public fun delete_collection(publication: &mut Publication, cap: &PublisherCap, name: String) {
  assert!(cap.publication_id == object::id(publication), EUnauthorized);

  let publication_id = object::id(publication);
  let (_, collection) = publication.collections.remove(&name);
  let collection_id = object::id(&collection);

  collection::delete_collection(collection);

  event::emit(CollectionRemoved { publication: publication_id, collection: collection_id, name });
}

/// Add a new singleton entry to the publication.
/// Aborts with `ESingletonAlreadyExists` if a singleton with the same name already exists.
public fun add_singleton(publication: &mut Publication, cap: &PublisherCap, entry: Entry) {
  assert!(cap.publication_id == object::id(publication), EUnauthorized);

  let publication_id = object::id(publication);
  let entry_name = entry.get_name();

  assert!(!publication.singletons.contains(entry_name), ESingletonAlreadyExists);
  publication.singletons.add(entry_name, entry);

  event::emit(SingletonAdded { publication: publication_id, name: entry_name });
}

/// Remove and delete a singleton entry from the publication.
/// Entry has drop trait, so it is automatically destroyed on removal.
public fun delete_singleton(publication: &mut Publication, cap: &PublisherCap, name: String) {
  assert!(cap.publication_id == object::id(publication), EUnauthorized);

  let publication_id = object::id(publication);
  publication.singletons.remove(name);

  event::emit(SingletonRemoved { publication: publication_id, name });
}

/// Return a reference to a singleton by name.
public fun get_singleton(publication: &Publication, name: String): &Entry {
  publication.singletons.borrow(name)
}

/// Return the number of singletons in the publication.
public fun singletons_length(publication: &Publication): u64 {
  publication.singletons.length()
}

/// Add an entry to a named collection within the publication.
public fun add_entry_to_collection(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry: Entry,
) {
  assert!(cap.publication_id == object::id(publication), EUnauthorized);
  let collection = publication.collections.get_mut(&collection_name);
  collection::add_entry(collection, entry);
}

/// Delete an entry by index from a named collection within the publication.
public fun delete_entry_from_collection(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  index: u64,
) {
  assert!(cap.publication_id == object::id(publication), EUnauthorized);
  let collection = publication.collections.get_mut(&collection_name);
  collection::delete_entry(collection, index);
}

// --- Events ---

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

/// Event emitted when a new PublisherCap is issued.
public struct PublisherCapIssued has copy, drop {
  publication: ID,
  cap: ID,
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

/// Event emitted when a new singleton entry is added to a publication.
public struct SingletonAdded has copy, drop {
  publication: ID,
  name: String,
}

/// Event emitted when a singleton entry is removed from a publication.
public struct SingletonRemoved has copy, drop {
  publication: ID,
  name: String,
}

// --- Internal helpers ---

fun create_publication(ctx: &mut TxContext, name: String): (Publication, OwnerCap, PublisherCap) {
  let publication = Publication {
    id: object::new(ctx),
    name,
    collections: vec_map::empty(),
    singletons: table::new(ctx),
  };

  let owner_cap = OwnerCap { id: object::new(ctx), publication_id: object::id(&publication) };
  let publisher_cap = PublisherCap { id: object::new(ctx), publication_id: object::id(&publication) };

  event::emit(PublicationCreated { publication: object::id(&publication), name });

  (publication, owner_cap, publisher_cap)
}

// --- Tests ---

#[test_only]
use std::unit_test;

#[test_only]
use std::unit_test::assert_eq;

/// Test helper: creates a publication without sharing/transferring, so tests can hold all objects directly.
#[test_only]
public fun new_publication_for_testing(ctx: &mut TxContext, name: String): (Publication, OwnerCap, PublisherCap) {
  create_publication(ctx, name)
}

#[test]
fun test_new_publication() {
  let ctx = &mut tx_context::dummy();
  let publication_name = b"ArcSys Blog".to_string();

  let (publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, publication_name);

  assert_eq!(publication.name, publication_name);
  assert_eq!(owner_cap.publication_id, object::id(&publication));
  assert_eq!(publisher_cap.publication_id, object::id(&publication));

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_delete_publication() {
  let ctx = &mut tx_context::dummy();
  let (publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  unit_test::destroy(publisher_cap);
  delete_publication(publication, owner_cap);
}

#[test]
fun test_issue_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let new_cap = issue_publisher_cap(&publication, &owner_cap, ctx);

  assert_eq!(new_cap.publication_id, object::id(&publication));

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(new_cap);
}

#[test]
fun test_destroy_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  destroy_publisher_cap(publisher_cap);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
}

#[test]
fun test_add_collection() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection = new_collection(object::id(&publication), collection_name, ctx);

  publication.add_collection(&publisher_cap, collection);

  assert_eq!(publication.collections.length(), 1);
  assert_eq!(publication.collections.contains(&collection_name), true);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
#[expected_failure(abort_code = ECollectionAlreadyExists)]
fun test_add_duplicate_collection() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection = new_collection(object::id(&publication), b"articles".to_string(), ctx);
  let duplicate = new_collection(object::id(&publication), b"articles".to_string(), ctx);

  publication.add_collection(&publisher_cap, collection);
  publication.add_collection(&publisher_cap, duplicate);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_delete_collection() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection = new_collection(object::id(&publication), collection_name, ctx);

  publication.add_collection(&publisher_cap, collection);
  assert_eq!(publication.collections.length(), 1);

  publication.delete_collection(&publisher_cap, collection_name);
  assert_eq!(publication.collections.length(), 0);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_publisher_can_add_collection() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, _publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  // Issue a cap to a "publisher" (simulated by creating a new cap)
  let publisher_cap = issue_publisher_cap(&publication, &owner_cap, ctx);
  let collection = new_collection(object::id(&publication), b"articles".to_string(), ctx);

  publication.add_collection(&publisher_cap, collection);

  assert_eq!(publication.collections.length(), 1);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(_publisher_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
#[expected_failure(abort_code = EUnauthorized)]
fun test_unauthorized_add_collection() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  // Create a cap for a DIFFERENT publication
  let (other_pub, other_owner_cap, other_publisher_cap) = new_publication_for_testing(ctx, b"Other".to_string());
  let collection = new_collection(object::id(&publication), b"articles".to_string(), ctx);

  // Using the wrong cap should abort
  publication.add_collection(&other_publisher_cap, collection);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_pub);
  unit_test::destroy(other_owner_cap);
  unit_test::destroy(other_publisher_cap);
}

#[test]
fun test_add_singleton() {
  use publication::entry::new_entry;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let mock_blob = object::new(ctx);
  let entry = new_entry(b"cover".to_string(), b"image/png".to_string(), mock_blob.to_inner());

  publication.add_singleton(&publisher_cap, entry);

  assert_eq!(singletons_length(&publication), 1);
  assert_eq!(publication.singletons.contains(b"cover".to_string()), true);

  unit_test::destroy(mock_blob);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
#[expected_failure(abort_code = ESingletonAlreadyExists)]
fun test_add_duplicate_singleton() {
  use publication::entry::new_entry;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let mock_blob_1 = object::new(ctx);
  let mock_blob_2 = object::new(ctx);
  let entry = new_entry(b"cover".to_string(), b"image/png".to_string(), mock_blob_1.to_inner());
  let duplicate = new_entry(b"cover".to_string(), b"image/png".to_string(), mock_blob_2.to_inner());

  publication.add_singleton(&publisher_cap, entry);
  publication.add_singleton(&publisher_cap, duplicate);

  unit_test::destroy(mock_blob_1);
  unit_test::destroy(mock_blob_2);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_delete_singleton() {
  use publication::entry::new_entry;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let mock_blob = object::new(ctx);
  let entry = new_entry(b"cover".to_string(), b"image/png".to_string(), mock_blob.to_inner());

  publication.add_singleton(&publisher_cap, entry);
  assert_eq!(singletons_length(&publication), 1);

  publication.delete_singleton(&publisher_cap, b"cover".to_string());
  assert_eq!(singletons_length(&publication), 0);

  unit_test::destroy(mock_blob);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_get_singleton() {
  use publication::entry::new_entry;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let mock_blob = object::new(ctx);
  let blob_id = mock_blob.to_inner();
  let entry = new_entry(b"cover".to_string(), b"image/png".to_string(), blob_id);

  publication.add_singleton(&publisher_cap, entry);

  let singleton = get_singleton(&publication, b"cover".to_string());
  assert_eq!(publication::entry::get_blob(singleton), blob_id);

  unit_test::destroy(mock_blob);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_add_entry_to_collection() {
  use publication::collection::new_collection;
  use publication::entry::new_entry;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection = new_collection(object::id(&publication), collection_name, ctx);
  publication.add_collection(&publisher_cap, collection);

  let mock_blob = object::new(ctx);
  let entry = new_entry(b"First Post".to_string(), b"application/json".to_string(), mock_blob.to_inner());
  publication.add_entry_to_collection(&publisher_cap, collection_name, entry);

  assert_eq!(collection::entries_length(publication.collections.get(&collection_name)), 1);

  unit_test::destroy(mock_blob);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_delete_entry_from_collection() {
  use publication::collection::new_collection;
  use publication::entry::new_entry;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection = new_collection(object::id(&publication), collection_name, ctx);
  publication.add_collection(&publisher_cap, collection);

  let mock_blob = object::new(ctx);
  let entry = new_entry(b"First Post".to_string(), b"application/json".to_string(), mock_blob.to_inner());
  publication.add_entry_to_collection(&publisher_cap, collection_name, entry);

  publication.delete_entry_from_collection(&publisher_cap, collection_name, 0);

  assert_eq!(collection::entries_length(publication.collections.get(&collection_name)), 0);

  unit_test::destroy(mock_blob);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}
