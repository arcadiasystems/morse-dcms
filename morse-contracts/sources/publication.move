/// Module: publication.
/// A publication is a root container for your content.
/// It also acts as an entry point for the publication, allowing users to interact with the publication and its content.
module publication::publication;

use std::string::String;
use std::string;
use sui::vec_map::{Self, VecMap};
use sui::table::{Self, Table};
use sui::event;

use publication::collection::{Self, Collection};
use publication::entry::{Self, Entry};

/// Root container for a publication's collections and singletons.
/// Created as a shared object so both the owner and issued publishers can interact with it.
/// All mutations require a valid PublisherCap or OwnerCap tied to this publication's ID.
///
/// `collections` uses `VecMap` because a publication is expected (and a *best practice*) to have only a few collections.
/// Root `singletons` and collection entries use `Table` because they can be numerous.
public struct Publication has key, store {
  id: UID,
  name: String,
  slug: String,
  collections: VecMap<String, Collection>,
  singletons: Table<String, Entry>,
  active_publisher_caps: Table<ID, address>,
}

/// Shared slug registry and canonical factory for publications.
public struct PublicationRegistry has key {
  id: UID,
  slugs: Table<String, ID>,
}

/// Proves ownership of a publication.
/// Required to issue PublisherCaps and delete the publication. Only one exists per publication.
/// Transferable by design: ownership can be transferred or sold.
public struct OwnerCap has key {
  id: UID,
  publication_id: ID,
}

/// Grants write access to a publication.
/// Issued by the owner via `issue_publisher_cap`. Multiple can exist per publication.
/// `holder` binds capability usage to a specific address to prevent permission sharing.
public struct PublisherCap has key {
  id: UID,
  publication_id: ID,
  holder: address,
}

/// Error code: a collection with the given name already exists in the publication.
const ECollectionAlreadyExists: u64 = 0;

/// Error code: a singleton with the given name already exists in the publication.
const ESingletonAlreadyExists: u64 = 1;

/// Error code: the capability does not belong to this publication.
const EUnauthorized: u64 = 2;

/// Error code: the collection was created for a different publication.
const ECollectionPublicationMismatch: u64 = 3;

/// Error code: the sender is not the approved holder for this PublisherCap.
const EPublisherCapWrongHolder: u64 = 4;

/// Error code: the publisher capability is not active.
const EPublisherCapNotActive: u64 = 5;

/// Error code: a publication with the given slug already exists.
const ESlugAlreadyExists: u64 = 6;

/// Error code: slug is empty.
const ESlugEmpty: u64 = 7;

/// Error code: slug exceeds max length.
const ESlugTooLong: u64 = 8;

/// Error code: slug contains invalid characters.
const ESlugInvalidChar: u64 = 9;

/// Error code: slug starts or ends with a hyphen.
const ESlugInvalidEdgeHyphen: u64 = 10;

/// Maximum allowed slug length.
const MAX_SLUG_LENGTH: u64 = 64;

/// Package initializer: create and share a single publication registry.
fun init(ctx: &mut TxContext) {
  transfer::share_object(PublicationRegistry {
    id: object::new(ctx),
    slugs: table::new(ctx),
  });
}

/// Create a new publication.
/// The publication is shared so publishers can interact with it.
/// An OwnerCap and a PublisherCap are transferred to the caller.
public fun new_publication(registry: &mut PublicationRegistry, ctx: &mut TxContext, name: String, slug: String) {
  validate_slug(&slug);
  assert!(!registry.slugs.contains(slug), ESlugAlreadyExists);

  let (publication, owner_cap, publisher_cap) = create_publication(ctx, name, slug);
  let publication_id = object::id(&publication);
  registry.slugs.add(slug, publication_id);

  event::emit(SlugRegistered { slug, publication: publication_id });
  transfer::share_object(publication);
  transfer::transfer(owner_cap, ctx.sender());
  transfer::transfer(publisher_cap, ctx.sender());
}

/// Delete a publication. Requires the OwnerCap; both are consumed.
/// All collections and singletons must be removed first, or this will abort.
public fun delete_publication(registry: &mut PublicationRegistry, publication: Publication, owner_cap: OwnerCap) {
  assert!(owner_cap.publication_id == object::id(&publication), EUnauthorized);

  let OwnerCap { id: cap_id, publication_id: _ } = owner_cap;
  cap_id.delete();

  let Publication { id, name, slug, collections, singletons, active_publisher_caps } = publication;
  let publication_id = id.to_inner();

  registry.slugs.remove(slug);
  event::emit(SlugReleased { slug, publication: publication_id });

  collections.destroy_empty();
  singletons.destroy_empty();
  active_publisher_caps.destroy_empty();
  id.delete();

  event::emit(PublicationDeleted { publication: publication_id, name });
}

/// Returns whether a slug is registered.
public fun contains_slug(registry: &PublicationRegistry, slug: String): bool {
  registry.slugs.contains(slug)
}

/// Return the publication ID for a slug.
public fun get_publication_id_by_slug(registry: &PublicationRegistry, slug: String): &ID {
  registry.slugs.borrow(slug)
}

/// Issue a new PublisherCap for this publication. Only callable by the owner.
/// The cap is bound to `holder`; only that address can use it.
public fun issue_publisher_cap(
  publication: &mut Publication,
  owner_cap: &OwnerCap,
  holder: address,
  ctx: &mut TxContext,
): PublisherCap {
  assert!(owner_cap.publication_id == object::id(publication), EUnauthorized);
  let cap = PublisherCap { id: object::new(ctx), publication_id: object::id(publication), holder };
  publication.active_publisher_caps.add(object::id(&cap), holder);
  event::emit(PublisherCapIssued { publication: object::id(publication), cap: object::id(&cap) });
  cap
}

/// Destroy a PublisherCap, voluntarily revoking write access.
/// Only the bound holder can destroy it.
public fun destroy_publisher_cap(publication: &mut Publication, cap: PublisherCap, ctx: &TxContext) {
  assert!(cap.publication_id == object::id(publication), EUnauthorized);
  assert!(cap.holder == ctx.sender(), EPublisherCapWrongHolder);
  let cap_id = object::id(&cap);
  if (publication.active_publisher_caps.contains(cap_id)) {
    publication.active_publisher_caps.remove(cap_id);
    event::emit(PublisherCapRevoked { publication: object::id(publication), cap: cap_id });
  };
  let PublisherCap { id, publication_id: _, holder: _ } = cap;
  id.delete();
}

/// Revoke a PublisherCap by ID. Only callable by the owner.
public fun revoke_publisher_cap(publication: &mut Publication, owner_cap: &OwnerCap, cap_id: ID) {
  assert!(owner_cap.publication_id == object::id(publication), EUnauthorized);
  assert!(publication.active_publisher_caps.contains(cap_id), EPublisherCapNotActive);
  publication.active_publisher_caps.remove(cap_id);
  event::emit(PublisherCapRevoked { publication: object::id(publication), cap: cap_id });
}

/// Transfer publication ownership to another address.
public fun transfer_owner_cap(owner_cap: OwnerCap, recipient: address) {
  transfer::transfer(owner_cap, recipient)
}

/// Create and add a new collection to the publication.
/// This is the canonical external flow for collection creation.
public fun create_collection(
  publication: &mut Publication,
  cap: &PublisherCap,
  name: String,
  ctx: &mut TxContext,
) {
  let publication_id = object::id(publication);
  let collection = collection::new_collection(publication_id, name, ctx);
  add_collection(publication, cap, collection, ctx);
}

/// Add a new collection to the publication.
/// Aborts with `ECollectionAlreadyExists` if a collection with the same name already exists.
/// Aborts with `ECollectionPublicationMismatch` if `collection.publication_id` does not match.
public fun add_collection(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection: Collection,
  ctx: &TxContext,
) {
  assert_active_publisher_cap(publication, cap, ctx);

  let publication_id = object::id(publication);
  let collection_id = object::id(&collection);
  assert!(collection::get_publication_id(&collection) == publication_id, ECollectionPublicationMismatch);
  let collection_name = collection.get_name();

  assert!(!publication.collections.contains(&collection_name), ECollectionAlreadyExists);
  publication.collections.insert(collection_name, collection);

  event::emit(CollectionAdded { publication: publication_id, collection: collection_id, name: collection_name });
}

/// Remove and delete a collection from the publication.
/// The collection's entries table must be empty, or this will abort.
public fun delete_collection(publication: &mut Publication, cap: &PublisherCap, name: String, ctx: &TxContext) {
  assert_active_publisher_cap(publication, cap, ctx);

  let publication_id = object::id(publication);
  let (_, collection) = publication.collections.remove(&name);
  let collection_id = object::id(&collection);

  collection::delete_collection(collection);

  event::emit(CollectionRemoved { publication: publication_id, collection: collection_id, name });
}

/// Add a new singleton entry to the publication.
/// Aborts with `ESingletonAlreadyExists` if a singleton with the same name already exists.
public fun add_singleton(publication: &mut Publication, cap: &PublisherCap, entry: Entry, ctx: &TxContext) {
  assert_active_publisher_cap(publication, cap, ctx);

  let publication_id = object::id(publication);
  let entry_name = entry.get_name();

  assert!(!publication.singletons.contains(entry_name), ESingletonAlreadyExists);
  publication.singletons.add(entry_name, entry);

  event::emit(SingletonAdded { publication: publication_id, name: entry_name });
}

/// Remove and delete a singleton entry from the publication.
/// Entry has drop trait, so it is automatically destroyed on removal.
public fun delete_singleton(publication: &mut Publication, cap: &PublisherCap, name: String, ctx: &TxContext) {
  assert_active_publisher_cap(publication, cap, ctx);

  let publication_id = object::id(publication);
  publication.singletons.remove(name);

  event::emit(SingletonRemoved { publication: publication_id, name });
}

/// Return a reference to a singleton by name.
public fun get_singleton(publication: &Publication, name: String): &Entry {
  publication.singletons.borrow(name)
}

/// Append a draft revision to an existing singleton entry.
public fun append_singleton_draft_revision(
  publication: &mut Publication,
  cap: &PublisherCap,
  name: String,
  content_type: String,
  blob: ID,
  encrypted: bool,
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let entry_ref = publication.singletons.borrow_mut(name);
  entry::append_draft_revision(entry_ref, content_type, blob, encrypted)
}

/// Publish a singleton from an existing draft revision.
public fun publish_singleton_from_draft(
  publication: &mut Publication,
  cap: &PublisherCap,
  name: String,
  draft_revision_id: u64,
  content_type: String,
  blob: ID,
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let entry_ref = publication.singletons.borrow_mut(name);
  entry::publish_from_draft(entry_ref, draft_revision_id, content_type, blob)
}

/// Publish a singleton directly (non-encrypted public revision).
public fun publish_singleton_direct(
  publication: &mut Publication,
  cap: &PublisherCap,
  name: String,
  content_type: String,
  blob: ID,
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let entry_ref = publication.singletons.borrow_mut(name);
  entry::publish_direct(entry_ref, content_type, blob)
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
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let collection = publication.collections.get_mut(&collection_name);
  collection::add_entry(collection, entry)
}

/// Delete an entry by `entry_id` from a named collection within the publication.
public fun delete_entry_from_collection(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry_id: u64,
  ctx: &TxContext,
) {
  assert_active_publisher_cap(publication, cap, ctx);
  let collection = publication.collections.get_mut(&collection_name);
  collection::delete_entry(collection, entry_id);
}

/// Append a draft revision to an existing collection entry.
public fun append_collection_entry_draft_revision(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry_id: u64,
  content_type: String,
  blob: ID,
  encrypted: bool,
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let collection = publication.collections.get_mut(&collection_name);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::append_draft_revision(entry_ref, content_type, blob, encrypted)
}

/// Publish an existing collection entry from a draft revision.
public fun publish_collection_entry_from_draft(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry_id: u64,
  draft_revision_id: u64,
  content_type: String,
  blob: ID,
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let collection = publication.collections.get_mut(&collection_name);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::publish_from_draft(entry_ref, draft_revision_id, content_type, blob)
}

/// Publish an existing collection entry directly (non-encrypted public revision).
public fun publish_collection_entry_direct(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry_id: u64,
  content_type: String,
  blob: ID,
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let collection = publication.collections.get_mut(&collection_name);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::publish_direct(entry_ref, content_type, blob)
}

// --- Events ---

/// Event emitted when a new publication is created.
public struct PublicationCreated has copy, drop {
  publication: ID,
  name: String,
  slug: String,
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

/// Event emitted when a PublisherCap is revoked.
public struct PublisherCapRevoked has copy, drop {
  publication: ID,
  cap: ID,
}

/// Event emitted when a slug is registered.
public struct SlugRegistered has copy, drop {
  slug: String,
  publication: ID,
}

/// Event emitted when a slug is released by publication deletion.
public struct SlugReleased has copy, drop {
  slug: String,
  publication: ID,
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

fun assert_active_publisher_cap(publication: &Publication, cap: &PublisherCap, ctx: &TxContext) {
  assert!(cap.publication_id == object::id(publication), EUnauthorized);
  assert!(cap.holder == ctx.sender(), EPublisherCapWrongHolder);
  assert!(publication.active_publisher_caps.contains(object::id(cap)), EPublisherCapNotActive);
}

fun validate_slug(slug: &String) {
  assert!(!slug.is_empty(), ESlugEmpty);
  assert!(slug.length() <= MAX_SLUG_LENGTH, ESlugTooLong);

  let bytes = string::as_bytes(slug);
  assert!(*vector::borrow(bytes, 0) != 45, ESlugInvalidEdgeHyphen);
  assert!(*vector::borrow(bytes, slug.length() - 1) != 45, ESlugInvalidEdgeHyphen);

  let mut i = 0;
  while (i < slug.length()) {
    let b = *vector::borrow(bytes, i);
    let is_lower = b >= 97 && b <= 122;
    let is_digit = b >= 48 && b <= 57;
    let is_hyphen = b == 45;
    assert!(is_lower || is_digit || is_hyphen, ESlugInvalidChar);
    i = i + 1;
  };
}

fun create_publication(ctx: &mut TxContext, name: String, slug: String): (Publication, OwnerCap, PublisherCap) {
  let mut publication = Publication {
    id: object::new(ctx),
    name,
    slug,
    collections: vec_map::empty(),
    singletons: table::new(ctx),
    active_publisher_caps: table::new(ctx),
  };

  let owner_cap = OwnerCap { id: object::new(ctx), publication_id: object::id(&publication) };
  let publisher_cap = PublisherCap {
    id: object::new(ctx),
    publication_id: object::id(&publication),
    holder: ctx.sender(),
  };

  publication.active_publisher_caps.add(object::id(&publisher_cap), publisher_cap.holder);

  event::emit(PublicationCreated { publication: object::id(&publication), name, slug });

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
  create_publication(ctx, name, b"test-slug".to_string())
}

#[test_only]
fun new_registry_for_testing(ctx: &mut TxContext): PublicationRegistry {
  PublicationRegistry {
    id: object::new(ctx),
    slugs: table::new(ctx),
  }
}

#[test_only]
fun new_publication_with_registry_for_testing(
  registry: &mut PublicationRegistry,
  ctx: &mut TxContext,
  name: String,
  slug: String,
): (Publication, OwnerCap, PublisherCap) {
  validate_slug(&slug);
  assert!(!registry.slugs.contains(slug), ESlugAlreadyExists);
  let (publication, owner_cap, publisher_cap) = create_publication(ctx, name, slug);
  registry.slugs.add(slug, object::id(&publication));
  (publication, owner_cap, publisher_cap)
}

#[test]
fun test_new_publication() {
  let ctx = &mut tx_context::dummy();
  let publication_name = b"ArcSys Blog".to_string();

  let (publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, publication_name);

  assert_eq!(publication.name, publication_name);
  assert_eq!(publication.slug, b"test-slug".to_string());
  assert_eq!(owner_cap.publication_id, object::id(&publication));
  assert_eq!(publisher_cap.publication_id, object::id(&publication));
  assert_eq!(publisher_cap.holder, ctx.sender());

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_slug_registry_lookup() {
  let ctx = &mut tx_context::dummy();
  let mut registry = new_registry_for_testing(ctx);
  let (publication, owner_cap, publisher_cap) = new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"ArcSys Blog".to_string(),
    b"my-personal-blog".to_string(),
  );

  assert_eq!(contains_slug(&registry, b"my-personal-blog".to_string()), true);
  assert_eq!(*get_publication_id_by_slug(&registry, b"my-personal-blog".to_string()), object::id(&publication));

  unit_test::destroy(registry);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
#[expected_failure(abort_code = ESlugAlreadyExists)]
fun test_duplicate_slug_fails() {
  let ctx = &mut tx_context::dummy();
  let mut registry = new_registry_for_testing(ctx);

  let (publication, owner_cap, publisher_cap) = new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"ArcSys Blog".to_string(),
    b"my-personal-blog".to_string(),
  );

  let (_other_publication, _other_owner_cap, _other_publisher_cap) = new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"Other".to_string(),
    b"my-personal-blog".to_string(),
  );

  unit_test::destroy(_other_publication);
  unit_test::destroy(_other_owner_cap);
  unit_test::destroy(_other_publisher_cap);
  unit_test::destroy(registry);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
#[expected_failure(abort_code = ESlugInvalidChar)]
fun test_invalid_slug_fails() {
  let ctx = &mut tx_context::dummy();
  let mut registry = new_registry_for_testing(ctx);
  let (publication, owner_cap, publisher_cap) = new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"ArcSys Blog".to_string(),
    b"My-Personal-Blog".to_string(),
  );
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(registry);
}

#[test]
fun test_slug_reusable_after_delete() {
  let ctx = &mut tx_context::dummy();
  let mut registry = new_registry_for_testing(ctx);

  let (mut publication, owner_cap, publisher_cap) = new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"ArcSys Blog".to_string(),
    b"my-personal-blog".to_string(),
  );

  publication.destroy_publisher_cap(publisher_cap, ctx);
  delete_publication(&mut registry, publication, owner_cap);
  assert_eq!(contains_slug(&registry, b"my-personal-blog".to_string()), false);

  let (publication2, owner_cap2, publisher_cap2) = new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"ArcSys Blog v2".to_string(),
    b"my-personal-blog".to_string(),
  );

  assert_eq!(contains_slug(&registry, b"my-personal-blog".to_string()), true);

  unit_test::destroy(registry);
  unit_test::destroy(publication2);
  unit_test::destroy(owner_cap2);
  unit_test::destroy(publisher_cap2);
}

#[test]
fun test_delete_publication() {
  let ctx = &mut tx_context::dummy();
  let mut registry = new_registry_for_testing(ctx);
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  registry.slugs.add(publication.slug, object::id(&publication));
  publication.destroy_publisher_cap(publisher_cap, ctx);
  delete_publication(&mut registry, publication, owner_cap);

  unit_test::destroy(registry);
}

#[test]
fun test_issue_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let new_cap = issue_publisher_cap(&mut publication, &owner_cap, ctx.sender(), ctx);

  assert_eq!(new_cap.publication_id, object::id(&publication));
  assert_eq!(new_cap.holder, ctx.sender());

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(new_cap);
}

#[test]
fun test_destroy_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  destroy_publisher_cap(&mut publication, publisher_cap, ctx);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
}

#[test]
#[expected_failure(abort_code = EPublisherCapWrongHolder)]
fun test_wrong_holder_cannot_use_publisher_cap() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let other_holder = @0xB;
  let other_cap = issue_publisher_cap(&mut publication, &owner_cap, other_holder, ctx);

  let collection = new_collection(object::id(&publication), b"articles".to_string(), ctx);
  publication.add_collection(&other_cap, collection, ctx);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_cap);
}

#[test]
#[expected_failure(abort_code = EPublisherCapWrongHolder)]
fun test_wrong_holder_cannot_destroy_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let other_cap = issue_publisher_cap(&mut publication, &owner_cap, @0xB, ctx);

  destroy_publisher_cap(&mut publication, other_cap, ctx);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_owner_can_revoke_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let cap = issue_publisher_cap(&mut publication, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  revoke_publisher_cap(&mut publication, &owner_cap, cap_id);

  assert_eq!(publication.active_publisher_caps.contains(cap_id), false);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(cap);
}

#[test]
#[expected_failure(abort_code = EPublisherCapNotActive)]
fun test_revoked_cap_cannot_write() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let cap = issue_publisher_cap(&mut publication, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  revoke_publisher_cap(&mut publication, &owner_cap, cap_id);

  let collection = new_collection(object::id(&publication), b"articles".to_string(), ctx);
  publication.add_collection(&cap, collection, ctx);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(cap);
}

#[test]
#[expected_failure(abort_code = EUnauthorized)]
fun test_wrong_owner_cannot_revoke_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let (other_publication, other_owner_cap, other_publisher_cap) =
    new_publication_for_testing(ctx, b"Other".to_string());
  let cap = issue_publisher_cap(&mut publication, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  revoke_publisher_cap(&mut publication, &other_owner_cap, cap_id);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_publication);
  unit_test::destroy(other_owner_cap);
  unit_test::destroy(other_publisher_cap);
  unit_test::destroy(cap);
}

#[test]
#[expected_failure(abort_code = EPublisherCapNotActive)]
fun test_revoke_nonexistent_cap_fails() {
  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let fake_cap = object::new(ctx);

  revoke_publisher_cap(&mut publication, &owner_cap, fake_cap.to_inner());

  unit_test::destroy(fake_cap);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_destroy_revoked_cap_succeeds() {
  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let cap = issue_publisher_cap(&mut publication, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  revoke_publisher_cap(&mut publication, &owner_cap, cap_id);
  destroy_publisher_cap(&mut publication, cap, ctx);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_add_collection() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection = new_collection(object::id(&publication), collection_name, ctx);

  publication.add_collection(&publisher_cap, collection, ctx);

  assert_eq!(publication.collections.length(), 1);
  assert_eq!(publication.collections.contains(&collection_name), true);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_create_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  publication.create_collection(&publisher_cap, b"articles".to_string(), ctx);

  assert_eq!(publication.collections.length(), 1);
  assert_eq!(publication.collections.contains(&b"articles".to_string()), true);

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

  publication.add_collection(&publisher_cap, collection, ctx);
  publication.add_collection(&publisher_cap, duplicate, ctx);

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

  publication.add_collection(&publisher_cap, collection, ctx);
  assert_eq!(publication.collections.length(), 1);

  publication.delete_collection(&publisher_cap, collection_name, ctx);
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
  let publisher_cap = issue_publisher_cap(&mut publication, &owner_cap, ctx.sender(), ctx);
  let collection = new_collection(object::id(&publication), b"articles".to_string(), ctx);

  publication.add_collection(&publisher_cap, collection, ctx);

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
  publication.add_collection(&other_publisher_cap, collection, ctx);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_pub);
  unit_test::destroy(other_owner_cap);
  unit_test::destroy(other_publisher_cap);
}

#[test]
#[expected_failure(abort_code = ECollectionPublicationMismatch)]
fun test_add_collection_with_mismatched_publication_id() {
  use publication::collection::new_collection;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let (other_publication, other_owner_cap, other_publisher_cap) =
    new_publication_for_testing(ctx, b"Other".to_string());

  let collection = new_collection(object::id(&other_publication), b"articles".to_string(), ctx);

  publication.add_collection(&publisher_cap, collection, ctx);

  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_publication);
  unit_test::destroy(other_owner_cap);
  unit_test::destroy(other_publisher_cap);
}

#[test]
fun test_add_singleton() {
  use publication::entry::new_entry;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let mock_blob = object::new(ctx);
  let entry = new_entry(b"cover".to_string(), b"image/png".to_string(), mock_blob.to_inner(), false);

  publication.add_singleton(&publisher_cap, entry, ctx);

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
  let entry = new_entry(b"cover".to_string(), b"image/png".to_string(), mock_blob_1.to_inner(), false);
  let duplicate = new_entry(b"cover".to_string(), b"image/png".to_string(), mock_blob_2.to_inner(), false);

  publication.add_singleton(&publisher_cap, entry, ctx);
  publication.add_singleton(&publisher_cap, duplicate, ctx);

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
  let entry = new_entry(b"cover".to_string(), b"image/png".to_string(), mock_blob.to_inner(), false);

  publication.add_singleton(&publisher_cap, entry, ctx);
  assert_eq!(singletons_length(&publication), 1);

  publication.delete_singleton(&publisher_cap, b"cover".to_string(), ctx);
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
  let entry = new_entry(b"cover".to_string(), b"image/png".to_string(), blob_id, false);

  publication.add_singleton(&publisher_cap, entry, ctx);

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
  publication.add_collection(&publisher_cap, collection, ctx);

  let mock_blob = object::new(ctx);
  let entry = new_entry(b"First Post".to_string(), b"application/json".to_string(), mock_blob.to_inner(), false);
  let entry_id = publication.add_entry_to_collection(&publisher_cap, collection_name, entry, ctx);

  assert_eq!(entry_id, 0);
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
  publication.add_collection(&publisher_cap, collection, ctx);

  let mock_blob = object::new(ctx);
  let entry = new_entry(b"First Post".to_string(), b"application/json".to_string(), mock_blob.to_inner(), false);
  let entry_id = publication.add_entry_to_collection(&publisher_cap, collection_name, entry, ctx);

  publication.delete_entry_from_collection(&publisher_cap, collection_name, entry_id, ctx);

  assert_eq!(collection::entries_length(publication.collections.get(&collection_name)), 0);

  unit_test::destroy(mock_blob);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_delete_then_add_entry_to_collection_uses_monotonic_entry_id() {
  use publication::collection::new_collection;
  use publication::entry::new_entry;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection = new_collection(object::id(&publication), collection_name, ctx);
  publication.add_collection(&publisher_cap, collection, ctx);

  let blob_0 = object::new(ctx);
  let blob_1 = object::new(ctx);
  let blob_2 = object::new(ctx);
  let blob_3 = object::new(ctx);

  let first_id = publication.add_entry_to_collection(
    &publisher_cap,
    collection_name,
    new_entry(b"a".to_string(), b"application/json".to_string(), blob_0.to_inner(), false),
    ctx,
  );
  let second_id = publication.add_entry_to_collection(
    &publisher_cap,
    collection_name,
    new_entry(b"b".to_string(), b"application/json".to_string(), blob_1.to_inner(), false),
    ctx,
  );
  let third_id = publication.add_entry_to_collection(
    &publisher_cap,
    collection_name,
    new_entry(b"c".to_string(), b"application/json".to_string(), blob_2.to_inner(), false),
    ctx,
  );

  publication.delete_entry_from_collection(&publisher_cap, collection_name, second_id, ctx);

  let fourth_id = publication.add_entry_to_collection(
    &publisher_cap,
    collection_name,
    new_entry(b"d".to_string(), b"application/json".to_string(), blob_3.to_inner(), false),
    ctx,
  );

  assert_eq!(first_id, 0);
  assert_eq!(second_id, 1);
  assert_eq!(third_id, 2);
  assert_eq!(fourth_id, 3);
  assert_eq!(collection::entries_length(publication.collections.get(&collection_name)), 3);

  unit_test::destroy(blob_0);
  unit_test::destroy(blob_1);
  unit_test::destroy(blob_2);
  unit_test::destroy(blob_3);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_singleton_draft_and_publish_heads() {
  use publication::entry::new_entry;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let blob_0 = object::new(ctx);
  let blob_1 = object::new(ctx);
  let blob_2 = object::new(ctx);

  let entry = new_entry(b"cover".to_string(), b"application/json".to_string(), blob_0.to_inner(), true);
  publication.add_singleton(&publisher_cap, entry, ctx);

  let draft_rev = publication.append_singleton_draft_revision(
    &publisher_cap,
    b"cover".to_string(),
    b"application/json".to_string(),
    blob_1.to_inner(),
    true,
    ctx,
  );

  let public_rev = publication.publish_singleton_from_draft(
    &publisher_cap,
    b"cover".to_string(),
    draft_rev,
    b"application/json".to_string(),
    blob_2.to_inner(),
    ctx,
  );

  let singleton = publication.get_singleton(b"cover".to_string());
  assert_eq!(entry::get_draft_head(singleton), option::some(draft_rev));
  assert_eq!(entry::get_public_head(singleton), option::some(public_rev));
  assert_eq!(entry::get_encrypted(singleton), false);

  unit_test::destroy(blob_0);
  unit_test::destroy(blob_1);
  unit_test::destroy(blob_2);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_collection_entry_draft_and_publish_heads() {
  use publication::collection::new_collection;
  use publication::entry::new_entry;

  let ctx = &mut tx_context::dummy();
  let (mut publication, owner_cap, publisher_cap) = new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection = new_collection(object::id(&publication), collection_name, ctx);
  publication.add_collection(&publisher_cap, collection, ctx);

  let blob_0 = object::new(ctx);
  let blob_1 = object::new(ctx);
  let blob_2 = object::new(ctx);

  let entry_id = publication.add_entry_to_collection(
    &publisher_cap,
    collection_name,
    new_entry(b"draft".to_string(), b"application/json".to_string(), blob_0.to_inner(), true),
    ctx,
  );

  let draft_rev = publication.append_collection_entry_draft_revision(
    &publisher_cap,
    collection_name,
    entry_id,
    b"application/json".to_string(),
    blob_1.to_inner(),
    true,
    ctx,
  );

  let public_rev = publication.publish_collection_entry_from_draft(
    &publisher_cap,
    collection_name,
    entry_id,
    draft_rev,
    b"application/json".to_string(),
    blob_2.to_inner(),
    ctx,
  );

  let collection = publication.collections.get_mut(&collection_name);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  assert_eq!(entry::get_draft_head(entry_ref), option::some(draft_rev));
  assert_eq!(entry::get_public_head(entry_ref), option::some(public_rev));
  assert_eq!(entry::get_encrypted(entry_ref), false);

  unit_test::destroy(blob_0);
  unit_test::destroy(blob_1);
  unit_test::destroy(blob_2);
  unit_test::destroy(publication);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}
