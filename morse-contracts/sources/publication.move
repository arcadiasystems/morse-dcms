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
use publication::entry::{Self};
use Walrus::blob::Blob;

// -- Publications --

/// Root container for a Publication of content.
/// `key` only (no `store`): sharing and transfer are gated through this module's functions,
/// enforced by the type system.
public struct Publication has key {
  id: UID,
  name: String,
  slug: String,
  /// `collections` uses `VecMap` because a publication is expected (and a *best practice*) to have only a few collections.
  collections: VecMap<String, Collection>,
  /// Denylist of revoked publisher cap IDs. Empty in the common case; only grows when a cap is revoked.
  /// Using a denylist (vs allowlist) means issuing caps is free — no table write until revocation is needed.
  /// Safe because `PublisherCap` has no `store` ability and no external constructor; caps cannot be fabricated.
  revoked_publisher_caps: Table<ID, bool>,
}

/// Create a new publication and return it along with its capabilities.
/// The caller is responsible for sharing the publication (via `share_publication`)
/// and transferring the caps as needed in their PTB.
/// The sender becomes the initial publisher (holder of the returned PublisherCap).
public fun new_publication(
  registry: &mut PublicationRegistry,
  ctx: &mut TxContext,
  name: String,
  slug: String,
): (Publication, OwnerCap, PublisherCap) {
  // Create publication object.
  let publication = Publication {
    id: object::new(ctx),
    name,
    slug,
    collections: vec_map::empty(),
    revoked_publisher_caps: table::new(ctx),
  };
  let publication_id = object::id(&publication);

  // Create and grant owner capability.
  let owner_cap = OwnerCap { id: object::new(ctx), publication_id: object::id(&publication) };

  // Create and grant initial publisher capability.
  // No table write needed: caps are valid by construction; only revocations are tracked.
  let publisher_cap = PublisherCap {
    id: object::new(ctx),
    publication_id: object::id(&publication),
    holder: ctx.sender(),
  };

  register_slug(registry, slug, publication_id);
  event::emit(PublicationCreated { publication: publication_id, name, slug });

  (publication, owner_cap, publisher_cap)
}

/// Share a publication so that publishers can interact with it.
/// Call this in your PTB after `new_publication`.
public fun share_publication(publication: Publication) {
  transfer::share_object(publication)
}

/// Delete a publication. Requires the OwnerCap; both are consumed.
/// All collections must be removed first, or this will abort.
public fun delete_publication(registry: &mut PublicationRegistry, publication: Publication, owner_cap: OwnerCap) {
  assert!(owner_cap.publication_id == object::id(&publication), EUnauthorized);

  let OwnerCap { id: cap_id, publication_id: _ } = owner_cap;
  cap_id.delete();

  let Publication { id, name, slug, collections, revoked_publisher_caps } = publication;
  let publication_id = id.to_inner();

  registry.slugs.remove(slug);
  event::emit(SlugReleased { slug, publication: publication_id });

  collections.destroy_empty();
  // Drop the revoked denylist regardless of remaining entries — bool values are droppable.
  revoked_publisher_caps.drop();
  id.delete();

  event::emit(PublicationDeleted { publication: publication_id, name });
}

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


// -- Registry --

/// Maximum allowed slug length.
const MAX_SLUG_LENGTH: u64 = 64;

/// Shared slug registry and canonical factory for publications.
public struct PublicationRegistry has key {
  id: UID,
  slugs: Table<String, ID>,
}

/// Package initializer: create and share a single publication registry.
fun init(ctx: &mut TxContext) {
  transfer::share_object(PublicationRegistry {
    id: object::new(ctx),
    slugs: table::new(ctx),
  });
}

/// Returns whether a slug is registered.
public fun contains_slug(registry: &PublicationRegistry, slug: String): bool {
  registry.slugs.contains(slug)
}

/// Return the publication ID for a slug.
public fun get_publication_id_by_slug(registry: &PublicationRegistry, slug: String): &ID {
  registry.slugs.borrow(slug)
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

fun register_slug(registry: &mut PublicationRegistry, slug: String, publication_id: ID) {
  validate_slug(&slug);
  assert!(!registry.slugs.contains(slug), ESlugAlreadyExists);
  registry.slugs.add(slug, publication_id);
  event::emit(SlugRegistered { slug, publication: publication_id });
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

#[test_only]
public(package) fun new_registry_for_testing(ctx: &mut TxContext): PublicationRegistry {
  PublicationRegistry {
    id: object::new(ctx),
    slugs: table::new(ctx),
  }
}

// -- Authorization --

/// Proves ownership of a publication.
/// Required to issue PublisherCaps and delete the publication. Only one exists per publication.
/// Transferable by design: ownership can be transferred or sold.
public struct OwnerCap has key {
  id: UID,
  publication_id: ID,
}

/// Transfer publication ownership to another address.
public fun transfer_owner_cap(owner_cap: OwnerCap, recipient: address) {
  transfer::transfer(owner_cap, recipient)
}

/// Grants write access to a publication.
/// Issued by the owner via `issue_publisher_cap`. Multiple can exist per publication.
/// `holder` binds capability usage to a specific address to prevent permission sharing.
public struct PublisherCap has key {
  id: UID,
  publication_id: ID,
  holder: address,
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
  // No table write: caps are valid by construction; only revocations are tracked in the denylist.
  event::emit(PublisherCapIssued { publication: object::id(publication), cap: object::id(&cap) });
  cap
}

/// Destroy a PublisherCap, voluntarily surrendering write access.
/// Only the bound holder can destroy it.
/// If the cap was previously revoked by the owner, this also removes it from the revoked denylist (storage cleanup).
public fun destroy_publisher_cap(publication: &mut Publication, cap: PublisherCap, ctx: &mut TxContext) {
  assert!(cap.publication_id == object::id(publication), EUnauthorized);
  assert!(cap.holder == ctx.sender(), EPublisherCapWrongHolder);
  let cap_id = object::id(&cap);
  if (publication.revoked_publisher_caps.contains(cap_id)) {
    publication.revoked_publisher_caps.remove(cap_id);
  };
  let PublisherCap { id, publication_id: _, holder: _ } = cap;
  id.delete();
}

/// Revoke a PublisherCap by ID. Only callable by the owner.
/// Adds the cap ID to the revoked denylist; future writes using that cap will be rejected.
public fun revoke_publisher_cap(publication: &mut Publication, owner_cap: &OwnerCap, cap_id: ID) {
  assert!(owner_cap.publication_id == object::id(publication), EUnauthorized);
  assert!(!publication.revoked_publisher_caps.contains(cap_id), EPublisherCapRevoked);
  publication.revoked_publisher_caps.add(cap_id, true);
  event::emit(PublisherCapRevoked { publication: object::id(publication), cap: cap_id });
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

/// Error code: the capability does not belong to this publication.
const EUnauthorized: u64 = 2;

/// Error code: the sender is not the approved holder for this PublisherCap.
const EPublisherCapWrongHolder: u64 = 4;

/// Error code: the publisher capability has been revoked.
const EPublisherCapRevoked: u64 = 5;

#[test_only]
public(package) fun is_publisher_cap_revoked(publication: &Publication, cap_id: ID): bool {
  publication.revoked_publisher_caps.contains(cap_id)
}

// internal
fun assert_active_publisher_cap(publication: &Publication, cap: &PublisherCap, ctx: &TxContext) {
  assert!(cap.publication_id == object::id(publication), EUnauthorized);
  assert!(cap.holder == ctx.sender(), EPublisherCapWrongHolder);
  assert!(!publication.revoked_publisher_caps.contains(object::id(cap)), EPublisherCapRevoked);
}

// -- Collections --

/// Error code: a collection with the given name already exists in the publication.
const ECollectionAlreadyExists: u64 = 0;

/// Create and add a new collection to the publication.
/// `storage_mode` must be `collection::STORAGE_MODE_BLOB` (0) or `collection::STORAGE_MODE_QUILT` (1).
/// The storage mode is immutable after creation and determines how entry blob references are stored.
public fun create_collection(
  publication: &mut Publication,
  cap: &PublisherCap,
  name: String,
  storage_mode: u8,
  ctx: &mut TxContext,
) {
  assert_active_publisher_cap(publication, cap, ctx);
  assert!(!publication.collections.contains(&name), ECollectionAlreadyExists);

  let publication_id = object::id(publication);
  let collection = collection::new_collection(name, storage_mode, ctx);
  let collection_name = collection.get_name();
  publication.collections.insert(collection_name, collection);

  event::emit(CollectionAdded { publication: publication_id, name: collection_name });
}

/// Remove and delete a collection from the publication.
/// The collection's entries table must be empty, or this will abort.
public fun delete_collection(publication: &mut Publication, cap: &PublisherCap, name: String, ctx: &mut TxContext) {
  assert_active_publisher_cap(publication, cap, ctx);

  let publication_id = object::id(publication);
  let (_, collection) = publication.collections.remove(&name);

  collection::delete_collection(collection);

  event::emit(CollectionRemoved { publication: publication_id, name });
}

/// Event emitted when a new collection is added to a publication.
public struct CollectionAdded has copy, drop {
  publication: ID,
  name: String,
}

/// Event emitted when a collection is removed from a publication.
public struct CollectionRemoved has copy, drop {
  publication: ID,
  name: String,
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
public(package) fun collection_entries_length(publication: &Publication, collection_name: String): u64 {
  let collection = publication.collections.get(&collection_name);
  collection::entries_length(collection)
}

// -- Entries --

/// Create a new entry and add it to a named collection within the publication.
/// Pass `quilt_patch_id: option::none()` for STORAGE_MODE_BLOB collections.
/// Pass `quilt_patch_id: option::some(<37-byte QuiltPatchId>)` for STORAGE_MODE_QUILT collections.
public fun add_entry_to_collection(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  name: String,
  blob: &Blob,
  quilt_patch_id: Option<vector<u8>>,
  content_type: String,
  encrypted: bool,
  access_policy: u8,
  seal_id: Option<vector<u8>>,
  ctx: &mut TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let sender = ctx.sender();
  let collection = publication.collections.get_mut(&collection_name);
  let blob_ref = entry::make_blob_ref(collection.get_storage_mode(), blob, quilt_patch_id);
  let new_entry = entry::new_entry(name, blob_ref, content_type, encrypted, sender, access_policy, seal_id);
  collection::add_entry(collection, new_entry)
}

/// Delete an entry by `entry_id` from a named collection within the publication.
public fun delete_entry_from_collection(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry_id: u64,
  ctx: &mut TxContext,
) {
  assert_active_publisher_cap(publication, cap, ctx);
  let collection = publication.collections.get_mut(&collection_name);
  collection::delete_entry(collection, entry_id);
}

/// Append a draft revision to an existing collection entry.
/// Pass `quilt_patch_id: option::none()` for STORAGE_MODE_BLOB collections.
/// Pass `quilt_patch_id: option::some(<37-byte QuiltPatchId>)` for STORAGE_MODE_QUILT collections.
public fun append_collection_entry_draft_revision(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry_id: u64,
  blob: &Blob,
  quilt_patch_id: Option<vector<u8>>,
  content_type: String,
  encrypted: bool,
  access_policy: u8,
  seal_id: Option<vector<u8>>,
  ctx: &mut TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let sender = ctx.sender();
  let collection = publication.collections.get_mut(&collection_name);
  let blob_ref = entry::make_blob_ref(collection.get_storage_mode(), blob, quilt_patch_id);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::append_draft_revision(entry_ref, blob_ref, content_type, encrypted, sender, access_policy, seal_id)
}

/// Publish an existing collection entry from a draft revision.
/// Pass `quilt_patch_id: option::none()` for STORAGE_MODE_BLOB collections.
/// Pass `quilt_patch_id: option::some(<37-byte QuiltPatchId>)` for STORAGE_MODE_QUILT collections.
public fun publish_collection_entry_from_draft(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry_id: u64,
  draft_revision_id: u64,
  blob: &Blob,
  quilt_patch_id: Option<vector<u8>>,
  content_type: String,
  ctx: &mut TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let sender = ctx.sender();
  let collection = publication.collections.get_mut(&collection_name);
  let blob_ref = entry::make_blob_ref(collection.get_storage_mode(), blob, quilt_patch_id);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::publish_from_draft(entry_ref, draft_revision_id, blob_ref, content_type, sender)
}

/// Publish an existing collection entry directly (non-encrypted public revision).
/// Pass `quilt_patch_id: option::none()` for STORAGE_MODE_BLOB collections.
/// Pass `quilt_patch_id: option::some(<37-byte QuiltPatchId>)` for STORAGE_MODE_QUILT collections.
public fun publish_collection_entry_direct(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry_id: u64,
  blob: &Blob,
  quilt_patch_id: Option<vector<u8>>,
  content_type: String,
  ctx: &mut TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let sender = ctx.sender();
  let collection = publication.collections.get_mut(&collection_name);
  let blob_ref = entry::make_blob_ref(collection.get_storage_mode(), blob, quilt_patch_id);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::publish_direct(entry_ref, blob_ref, content_type, sender)
}

#[test_only]
public(package) fun collection_storage_mode(publication: &Publication, collection_name: String): u8 {
  let collection = publication.collections.get(&collection_name);
  collection.get_storage_mode()
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

#[test_only]
public(package) fun collection_entry_access_policy(publication: &mut Publication, collection_name: String, entry_id: u64): u8 {
  let collection = publication.collections.get_mut(&collection_name);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::get_access_policy(entry_ref)
}

#[test_only]
public(package) fun collection_entry_has_seal_id(publication: &mut Publication, collection_name: String, entry_id: u64): bool {
  let collection = publication.collections.get_mut(&collection_name);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  option::is_some(&entry::get_seal_id(entry_ref))
}

#[test_only]
public(package) fun collection_entry_draft_head(publication: &mut Publication, collection_name: String, entry_id: u64): Option<u64> {
  let collection = publication.collections.get_mut(&collection_name);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::get_draft_head(entry_ref)
}

/// Test bypass for `add_entry_to_collection`: accepts raw blob_id/quilt_patch_id instead of `&Blob`.
#[test_only]
public(package) fun add_entry_to_collection_for_testing(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  name: String,
  blob_id: ID,
  quilt_patch_id: Option<vector<u8>>,
  content_type: String,
  encrypted: bool,
  access_policy: u8,
  seal_id: Option<vector<u8>>,
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let sender = ctx.sender();
  let collection = publication.collections.get_mut(&collection_name);
  let blob_ref = entry::make_blob_ref_for_testing(collection.get_storage_mode(), blob_id, quilt_patch_id);
  let new_entry = entry::new_entry_for_testing(name, blob_ref, content_type, encrypted, sender, access_policy, seal_id);
  collection::add_entry(collection, new_entry)
}

/// Test bypass for `publish_collection_entry_direct`: accepts raw blob_id/quilt_patch_id instead of `&Blob`.
#[test_only]
public(package) fun publish_collection_entry_direct_for_testing(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry_id: u64,
  blob_id: ID,
  quilt_patch_id: Option<vector<u8>>,
  content_type: String,
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let sender = ctx.sender();
  let collection = publication.collections.get_mut(&collection_name);
  let blob_ref = entry::make_blob_ref_for_testing(collection.get_storage_mode(), blob_id, quilt_patch_id);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::publish_direct_for_testing(entry_ref, blob_ref, content_type, sender)
}

/// Test bypass for `append_collection_entry_draft_revision`: accepts raw blob_id/quilt_patch_id instead of `&Blob`.
#[test_only]
public(package) fun append_collection_entry_draft_revision_for_testing(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry_id: u64,
  blob_id: ID,
  quilt_patch_id: Option<vector<u8>>,
  content_type: String,
  encrypted: bool,
  access_policy: u8,
  seal_id: Option<vector<u8>>,
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let sender = ctx.sender();
  let collection = publication.collections.get_mut(&collection_name);
  let blob_ref = entry::make_blob_ref_for_testing(collection.get_storage_mode(), blob_id, quilt_patch_id);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::append_draft_revision_for_testing(entry_ref, blob_ref, content_type, encrypted, sender, access_policy, seal_id)
}

/// Test bypass for `publish_collection_entry_from_draft`: accepts raw blob_id/quilt_patch_id instead of `&Blob`.
#[test_only]
public(package) fun publish_collection_entry_from_draft_for_testing(
  publication: &mut Publication,
  cap: &PublisherCap,
  collection_name: String,
  entry_id: u64,
  draft_revision_id: u64,
  blob_id: ID,
  quilt_patch_id: Option<vector<u8>>,
  content_type: String,
  ctx: &TxContext,
): u64 {
  assert_active_publisher_cap(publication, cap, ctx);
  let sender = ctx.sender();
  let collection = publication.collections.get_mut(&collection_name);
  let blob_ref = entry::make_blob_ref_for_testing(collection.get_storage_mode(), blob_id, quilt_patch_id);
  let entry_ref = collection::get_entry_mut(collection, entry_id);
  entry::publish_from_draft_for_testing(entry_ref, draft_revision_id, blob_ref, content_type, sender)
}

// -- Seal (encryption) --

/// Seal approval policy: allow decryption for active publisher holders of this publication.
///
/// Why we validate `id` namespace (not just publisher cap):
/// - It ensures a valid publisher cap for Publication A cannot approve identities from Publication B.
/// - It reserves policy separation inside the same publication namespace (publisher tag now,
///   future policy tags later, e.g. subscription), so this entrypoint only approves
///   publisher-gated encrypted content.
entry fun seal_approve_publisher(id: vector<u8>, publication: &Publication, cap: &PublisherCap, ctx: &TxContext) {
  assert_active_publisher_cap(publication, cap, ctx);
  assert_valid_publisher_seal_id(publication, &id);
}

fun assert_valid_publisher_seal_id(publication: &Publication, id: &vector<u8>) {
  // Expected format: [publication_id_bytes][policy_tag][nonce...]
  // - publication_id_bytes scopes identity to this publication.
  // - policy_tag scopes identity to the publisher policy entrypoint.
  // - nonce ensures many unique identities can exist under that namespace.
  let prefix = object::id(publication).to_bytes();
  let prefix_len = prefix.length();
  assert!(id.length() > prefix_len + 1, ESealInvalidId);

  let mut i = 0;
  while (i < prefix_len) {
    assert!(*vector::borrow(&prefix, i) == *vector::borrow(id, i), ESealInvalidId);
    i = i + 1;
  };

  assert!(*vector::borrow(id, prefix_len) == SEAL_POLICY_TAG_PUBLISHER, ESealWrongPolicyTag);
}

/// Error code: provided Seal identity does not match this publication namespace.
const ESealInvalidId: u64 = 12;

/// Error code: provided Seal identity has an unsupported policy tag.
const ESealWrongPolicyTag: u64 = 13;

/// Seal policy tag for publisher-gated encrypted content.
const SEAL_POLICY_TAG_PUBLISHER: u8 = 1;

#[test_only]
public(package) fun publisher_seal_id_for_testing(publication: &Publication, nonce: vector<u8>): vector<u8> {
  let mut id = object::id(publication).to_bytes();
  vector::push_back(&mut id, SEAL_POLICY_TAG_PUBLISHER);
  id.append(nonce);
  id
}

#[test_only]
public(package) fun seal_approve_publisher_for_testing(id: vector<u8>, publication: &Publication, cap: &PublisherCap, ctx: &TxContext) {
  seal_approve_publisher(id, publication, cap, ctx);
}

