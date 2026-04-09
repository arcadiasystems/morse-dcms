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

// --- Data structures ---

/// Root container for a publication's collections.
/// Created as a shared object so both the owner and issued publishers can interact with it.
/// All mutations require a valid PublisherCap or OwnerCap tied to this publication's ID.
///
/// `collections` uses `VecMap` because a publication is expected (and a *best practice*) to have only a few collections.
public struct Publication has key, store {
  id: UID,
  name: String,
  slug: String,
  collections: VecMap<String, Collection>,
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

// --- Constants ---

/// Maximum allowed slug length.
const MAX_SLUG_LENGTH: u64 = 64;

// --- Error codes ---

/// Error code: a collection with the given name already exists in the publication.
const ECollectionAlreadyExists: u64 = 0;

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

/// Error code: entry author does not match transaction sender.
const EEntryAuthorMismatch: u64 = 11;

// --- Public API ---

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
/// All collections must be removed first, or this will abort.
public fun delete_publication(registry: &mut PublicationRegistry, publication: Publication, owner_cap: OwnerCap) {
  assert!(owner_cap.publication_id == object::id(&publication), EUnauthorized);

  let OwnerCap { id: cap_id, publication_id: _ } = owner_cap;
  cap_id.delete();

  let Publication { id, name, slug, collections, active_publisher_caps } = publication;
  let publication_id = id.to_inner();

  registry.slugs.remove(slug);
  event::emit(SlugReleased { slug, publication: publication_id });

  collections.destroy_empty();
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

/// Add an entry to a named collection within the publication.
public fun add_entry_to_collection(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry: Entry,
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  assert!(entry::get_author(&entry) == ctx.sender(), EEntryAuthorMismatch);
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
  entry::append_draft_revision(entry_ref, content_type, blob, encrypted, ctx.sender())
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
  entry::publish_from_draft(entry_ref, draft_revision_id, content_type, blob, ctx.sender())
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
  entry::publish_direct(entry_ref, content_type, blob, ctx.sender())
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

// --- Test query helpers ---

#[test_only]
public(package) fun name(publication: &Publication): String {
  publication.name
}

#[test_only]
public(package) fun slug(publication: &Publication): String {
  publication.slug
}

#[test_only]
public(package) fun owner_cap_publication_id(owner_cap: &OwnerCap): ID {
  owner_cap.publication_id
}

#[test_only]
public(package) fun publisher_cap_publication_id(cap: &PublisherCap): ID {
  cap.publication_id
}

#[test_only]
public(package) fun publisher_cap_holder(cap: &PublisherCap): address {
  cap.holder
}

#[test_only]
public(package) fun collections_length(publication: &Publication): u64 {
  publication.collections.length()
}

#[test_only]
public(package) fun contains_collection(publication: &Publication, name: String): bool {
  publication.collections.contains(&name)
}

#[test_only]
public(package) fun contains_active_publisher_cap(publication: &Publication, cap_id: ID): bool {
  publication.active_publisher_caps.contains(cap_id)
}

#[test_only]
public(package) fun collection_entries_length(publication: &Publication, collection_name: String): u64 {
  let collection = publication.collections.get(&collection_name);
  collection::entries_length(collection)
}

#[test_only]
public(package) fun collection_entry_draft_head(publication: &mut Publication, collection_name: String, entry_id: u64): Option<u64> {
  let collection = publication.collections.get_mut(&collection_name);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::get_draft_head(entry_ref)
}

#[test_only]
public(package) fun collection_entry_public_head(publication: &mut Publication, collection_name: String, entry_id: u64): Option<u64> {
  let collection = publication.collections.get_mut(&collection_name);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::get_public_head(entry_ref)
}

#[test_only]
public(package) fun collection_entry_encrypted(publication: &mut Publication, collection_name: String, entry_id: u64): bool {
  let collection = publication.collections.get_mut(&collection_name);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::get_encrypted(entry_ref)
}

// --- Test helpers ---

/// Test helper: creates a publication without sharing/transferring, so tests can hold all objects directly.
#[test_only]
public(package) fun new_publication_for_testing(ctx: &mut TxContext, name: String): (Publication, OwnerCap, PublisherCap) {
  create_publication(ctx, name, b"test-slug".to_string())
}

#[test_only]
public(package) fun new_registry_for_testing(ctx: &mut TxContext): PublicationRegistry {
  PublicationRegistry {
    id: object::new(ctx),
    slugs: table::new(ctx),
  }
}

#[test_only]
public(package) fun new_publication_with_registry_for_testing(
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
