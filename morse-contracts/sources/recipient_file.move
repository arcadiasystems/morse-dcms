/// Module: recipient_file.
/// Encrypted files stored on Walrus with a per-file recipient set gating
/// decryption. The owner can mutate metadata, add/remove recipients, transfer
/// ownership, and delete the record. Encryption uses Seal under an identity
/// rooted at the file id; decryption is gated by the recipient set via
/// `seal_approve`.
///
/// Distinct from the legacy `file::EncryptedFile` + `allowlist::Allowlist`
/// pair: this module embeds the recipient set directly on the file, removing
/// the separate allowlist concept. Each file is independent; there is no
/// shared ACL across files. Use this for "share THIS file with these
/// addresses" UX. The legacy modules remain in the contract bytecode for
/// backward compat with v0.2 / v0.3 clients but new code uses this module.
module publication::recipient_file;

use std::string::String;
use sui::clock::Clock;
use sui::dynamic_field as df;
use sui::event;
use sui::vec_set::{Self, VecSet};

// -- RecipientFile --

/// On-chain metadata + recipient set for a single Walrus-stored file.
/// `key` only; share via `share_recipient_file` to make readable by any
/// wallet. Decryption access is governed entirely by `members`.
public struct RecipientFile has key {
  id: UID,
  /// Address that may mutate metadata, edit recipients, transfer ownership,
  /// or delete the record. Auto-included in `members` on creation.
  owner: address,
  /// Walrus content id (CID).
  blob_id: vector<u8>,
  /// On-chain Walrus `Blob` object id, when known. Optional because HTTP
  /// publisher uploads and third-party-certified blobs do not always yield
  /// an owned `Blob` object on the consumer's address.
  blob_object_id: Option<ID>,
  /// Original filename.
  name: String,
  /// MIME type, lowercase recommended; not enforced.
  content_type: String,
  /// Plaintext byte length (Walrus stores larger ciphertext due to Seal
  /// envelope overhead). Useful for UI; not validated against Walrus.
  size: u64,
  /// Addresses that may decrypt this file. Owner auto-included on creation.
  /// `VecSet` keeps membership unique; expected size is tens of recipients
  /// per file (PTB transaction size caps the total at hundreds in practice).
  members: VecSet<address>,
  /// Sui-clock timestamp at creation, in milliseconds since unix epoch.
  /// Set once; never updated.
  created_at_ms: u64,
}

/// Create an encrypted file with a list of recipients. The transaction
/// sender is auto-added to the recipient set; the uploader can decrypt
/// their own file without listing themselves. Duplicate recipients
/// (including a self-reference in `recipients`) are silently deduplicated.
///
/// Caller is responsible for having already uploaded the Seal-encrypted
/// bytes to Walrus under this file's identity namespace.
///
/// Pure: returns the file by value; caller must share it via
/// `share_recipient_file` to make it usable.
///
/// Aborts on empty `blob_id`, empty `name`, or empty `content_type`.
public fun new_recipient_file(
  blob_id: vector<u8>,
  blob_object_id: Option<ID>,
  name: String,
  content_type: String,
  size: u64,
  recipients: vector<address>,
  clock: &Clock,
  ctx: &mut TxContext,
): RecipientFile {
  assert_valid_blob_id(&blob_id);
  assert_valid_name(&name);
  assert_valid_content_type(&content_type);

  let sender = ctx.sender();
  let mut members = vec_set::empty<address>();
  members.insert(sender);

  let mut i = 0;
  while (i < recipients.length()) {
    let addr = *recipients.borrow(i);
    if (!members.contains(&addr)) {
      members.insert(addr);
    };
    i = i + 1;
  };

  let members_snapshot = *members.keys();

  let file = RecipientFile {
    id: object::new(ctx),
    owner: sender,
    blob_id,
    blob_object_id,
    name,
    content_type,
    size,
    members,
    created_at_ms: clock.timestamp_ms(),
  };

  event::emit(RecipientFileCreated {
    file: object::id(&file),
    owner: sender,
    name: file.name,
    content_type: file.content_type,
    size,
    members: members_snapshot,
  });

  file
}

/// Share the file so its `seal_approve` can be dry-run by Seal key servers
/// regardless of the caller's wallet. Call this in your PTB after
/// `new_recipient_file`.
public fun share_recipient_file(file: RecipientFile) {
  transfer::share_object(file)
}

/// Delete a file metadata record. Does NOT delete the Walrus blob; that
/// follows the Walrus lease lifecycle independently. Owner only.
public fun delete_file(file: RecipientFile, ctx: &TxContext) {
  assert!(file.owner == ctx.sender(), EUnauthorized);
  let file_id = object::id(&file);
  let RecipientFile {
    id,
    owner: _,
    blob_id: _,
    blob_object_id: _,
    name,
    content_type: _,
    size: _,
    members: _,
    created_at_ms: _,
  } = file;
  id.delete();
  event::emit(RecipientFileDeleted { file: file_id, name });
}

/// Update the file's `name` and `content_type`. Other fields are immutable
/// post-creation. Owner only.
public fun update_metadata(
  file: &mut RecipientFile,
  name: String,
  content_type: String,
  ctx: &TxContext,
) {
  assert!(file.owner == ctx.sender(), EUnauthorized);
  assert_valid_name(&name);
  assert_valid_content_type(&content_type);
  file.name = name;
  file.content_type = content_type;
  event::emit(RecipientFileMetadataUpdated {
    file: object::id(file),
    name: file.name,
    content_type: file.content_type,
  });
}

/// Transfer the metadata-mutation right to a new address. Does NOT touch
/// the `members` set; if you want full handover (new owner gains decrypt
/// access, old owner loses it), compose with `add_recipient` and
/// `remove_recipient` in the same PTB. Owner only.
public fun transfer_ownership(
  file: &mut RecipientFile,
  new_owner: address,
  ctx: &TxContext,
) {
  assert!(file.owner == ctx.sender(), EUnauthorized);
  let previous = file.owner;
  file.owner = new_owner;
  event::emit(RecipientFileOwnershipTransferred {
    file: object::id(file),
    previous_owner: previous,
    new_owner,
  });
}

// -- Recipients --

/// Add an address to the recipient set. Idempotent at the contract level:
/// aborts on duplicate. Owner only.
public fun add_recipient(
  file: &mut RecipientFile,
  recipient: address,
  ctx: &TxContext,
) {
  assert!(file.owner == ctx.sender(), EUnauthorized);
  assert!(!file.members.contains(&recipient), ERecipientAlreadyPresent);
  file.members.insert(recipient);
  event::emit(RecipientAdded { file: object::id(file), recipient });
}

/// Remove an address from the recipient set. Aborts on non-member. The
/// owner CAN remove themselves; doing so deletes their decrypt access but
/// not their mutation rights (those still come from the `owner` field).
/// Owner only.
public fun remove_recipient(
  file: &mut RecipientFile,
  recipient: address,
  ctx: &TxContext,
) {
  assert!(file.owner == ctx.sender(), EUnauthorized);
  assert!(file.members.contains(&recipient), ERecipientNotPresent);
  file.members.remove(&recipient);
  event::emit(RecipientRemoved { file: object::id(file), recipient });
}

// -- Events --

/// Emitted on `new_recipient_file`. Carries the full initial member list so
/// indexers do not need to also follow per-member `RecipientAdded` events
/// at creation time.
public struct RecipientFileCreated has copy, drop {
  file: ID,
  owner: address,
  name: String,
  content_type: String,
  size: u64,
  members: vector<address>,
}

public struct RecipientFileDeleted has copy, drop {
  file: ID,
  name: String,
}

public struct RecipientFileMetadataUpdated has copy, drop {
  file: ID,
  name: String,
  content_type: String,
}

public struct RecipientFileOwnershipTransferred has copy, drop {
  file: ID,
  previous_owner: address,
  new_owner: address,
}

public struct RecipientAdded has copy, drop {
  file: ID,
  recipient: address,
}

public struct RecipientRemoved has copy, drop {
  file: ID,
  recipient: address,
}

// -- Errors --

/// Error code: sender is not the file owner.
const EUnauthorized: u64 = 0;

/// Error code: `blob_id` must be non-empty.
const EBlobIdEmpty: u64 = 1;

/// Error code: `name` must be non-empty and within the max length.
const ENameInvalid: u64 = 2;

/// Error code: `content_type` must be non-empty and within the max length.
const EContentTypeInvalid: u64 = 3;

/// Error code: address is already a recipient.
const ERecipientAlreadyPresent: u64 = 4;

/// Error code: address is not a recipient.
const ERecipientNotPresent: u64 = 5;

/// Error code: provided Seal identity does not match this file's namespace.
const ESealInvalidId: u64 = 6;

/// Error code: provided Seal identity has an unsupported policy tag.
const ESealWrongPolicyTag: u64 = 7;

/// Error code: sender is not a recipient of the file.
const ENoAccess: u64 = 8;

/// Error code: caller-supplied `seal_id_prefix` is empty.
const ESealPrefixEmpty: u64 = 9;

/// Error code: file was not created with an attached seal prefix and
/// `seal_approve_with_prefix` cannot apply.
const ESealPrefixMissing: u64 = 10;

/// Bounds matching `entry::ENameTooLong` and `entry::EContentTypeTooLong`
/// for cross-module consistency. Not enforced as MIME-case-aware.
const MAX_NAME_LENGTH: u64 = 256;
const MAX_CONTENT_TYPE_LENGTH: u64 = 255;

// -- Seal --

/// Seal access-control entry point. Key servers dry-run this before
/// releasing decryption shares. Identity format expected:
///   [file_id_bytes (32)][SEAL_POLICY_TAG_RECIPIENT_FILE = 3][nonce...]
/// Aborts unless the sender is a current recipient AND the identity matches
/// the expected prefix + policy tag.
entry fun seal_approve(id: vector<u8>, file: &RecipientFile, ctx: &TxContext) {
  assert_valid_recipient_file_seal_id(file, &id);
  assert!(file.members.contains(&ctx.sender()), ENoAccess);
}

/// Seal policy tag for the recipient-file policy. Distinct from
/// `publication.move`'s publisher policy (1) and `allowlist.move`'s
/// allowlist policy (2) so all three coexist in the same package without
/// identity-namespace collisions.
const SEAL_POLICY_TAG_RECIPIENT_FILE: u8 = 3;

// -- Seal with caller-supplied prefix --

/// Dynamic-field key used to attach a caller-supplied seal identity prefix
/// to a `RecipientFile`. Lets clients encrypt under an identity they choose
/// before the file's Sui object id exists, then bind the prefix on
/// creation. Required for single-PTB encrypted upload flows (the file's
/// Sui object id is not predictable before signing).
public struct SealPrefixKey has copy, drop, store {}

/// Create a recipient file and attach a caller-supplied seal identity
/// prefix to it via a dynamic field. The Seal identity used to encrypt the
/// associated Walrus blob is `[seal_id_prefix || tag=3 || nonce]`. The
/// prefix is bound at creation and immutable.
///
/// Pure: returns the file by value; caller must share it via
/// `share_recipient_file` to make it usable.
///
/// Aborts on empty `seal_id_prefix`, empty `blob_id`, empty `name`, or
/// empty `content_type`. The prefix may be any non-empty byte string;
/// callers typically use 32 random bytes (collision-resistant per file).
public fun new_recipient_file_with_seal_prefix(
  seal_id_prefix: vector<u8>,
  blob_id: vector<u8>,
  blob_object_id: Option<ID>,
  name: String,
  content_type: String,
  size: u64,
  recipients: vector<address>,
  clock: &Clock,
  ctx: &mut TxContext,
): RecipientFile {
  assert!(!seal_id_prefix.is_empty(), ESealPrefixEmpty);
  let mut file = new_recipient_file(
    blob_id,
    blob_object_id,
    name,
    content_type,
    size,
    recipients,
    clock,
    ctx,
  );
  df::add(&mut file.id, SealPrefixKey {}, seal_id_prefix);
  event::emit(RecipientFileSealPrefixAttached {
    file: object::id(&file),
    seal_id_prefix,
  });
  file
}

/// Seal access-control entry point for files created via
/// `new_recipient_file_with_seal_prefix`. Key servers dry-run this before
/// releasing decryption shares. Identity format expected:
///   [seal_id_prefix][SEAL_POLICY_TAG_RECIPIENT_FILE = 3][nonce...]
/// Aborts unless the file carries an attached `SealPrefixKey` dynamic
/// field, the identity starts with the attached prefix, the policy tag is
/// 3, and the sender is a current recipient.
entry fun seal_approve_with_prefix(
  id: vector<u8>,
  file: &RecipientFile,
  ctx: &TxContext,
) {
  assert!(df::exists_(&file.id, SealPrefixKey {}), ESealPrefixMissing);
  let prefix: &vector<u8> = df::borrow(&file.id, SealPrefixKey {});
  assert_id_matches_prefix(prefix, &id);
  assert!(file.members.contains(&ctx.sender()), ENoAccess);
}

/// Returns the attached seal identity prefix, or `none` if the file was
/// created via the legacy `new_recipient_file` path. Lets clients decide
/// which `seal_approve` variant to use at decrypt time.
public fun get_seal_id_prefix(file: &RecipientFile): Option<vector<u8>> {
  if (df::exists_(&file.id, SealPrefixKey {})) {
    let prefix: &vector<u8> = df::borrow(&file.id, SealPrefixKey {});
    option::some(*prefix)
  } else {
    option::none()
  }
}

/// Emitted on `new_recipient_file_with_seal_prefix` immediately after
/// `RecipientFileCreated`. Indexers building decrypt-side flows read this
/// to learn which prefix was bound to the file.
public struct RecipientFileSealPrefixAttached has copy, drop {
  file: ID,
  seal_id_prefix: vector<u8>,
}

// -- Reads --

public fun get_owner(file: &RecipientFile): address { file.owner }
public fun get_blob_id(file: &RecipientFile): vector<u8> { file.blob_id }
public fun get_blob_object_id(file: &RecipientFile): Option<ID> { file.blob_object_id }
public fun get_name(file: &RecipientFile): String { file.name }
public fun get_content_type(file: &RecipientFile): String { file.content_type }
public fun get_size(file: &RecipientFile): u64 { file.size }
public fun get_created_at_ms(file: &RecipientFile): u64 { file.created_at_ms }
public fun is_recipient(file: &RecipientFile, addr: address): bool {
  file.members.contains(&addr)
}
public fun recipient_count(file: &RecipientFile): u64 { file.members.length() }

// internal

fun assert_valid_blob_id(blob_id: &vector<u8>) {
  assert!(!blob_id.is_empty(), EBlobIdEmpty);
}

fun assert_valid_name(name: &String) {
  assert!(!name.is_empty(), ENameInvalid);
  assert!(name.length() <= MAX_NAME_LENGTH, ENameInvalid);
}

fun assert_valid_content_type(content_type: &String) {
  assert!(!content_type.is_empty(), EContentTypeInvalid);
  assert!(content_type.length() <= MAX_CONTENT_TYPE_LENGTH, EContentTypeInvalid);
}

fun assert_valid_recipient_file_seal_id(file: &RecipientFile, id: &vector<u8>) {
  let prefix = object::id(file).to_bytes();
  assert_id_matches_prefix(&prefix, id);
}

fun assert_id_matches_prefix(prefix: &vector<u8>, id: &vector<u8>) {
  let prefix_len = prefix.length();
  assert!(id.length() > prefix_len + 1, ESealInvalidId);

  let mut i = 0;
  while (i < prefix_len) {
    assert!(*vector::borrow(prefix, i) == *vector::borrow(id, i), ESealInvalidId);
    i = i + 1;
  };

  assert!(
    *vector::borrow(id, prefix_len) == SEAL_POLICY_TAG_RECIPIENT_FILE,
    ESealWrongPolicyTag,
  );
}

#[test_only]
public(package) fun recipient_file_seal_id_for_testing(
  file: &RecipientFile,
  nonce: vector<u8>,
): vector<u8> {
  let mut id = object::id(file).to_bytes();
  vector::push_back(&mut id, SEAL_POLICY_TAG_RECIPIENT_FILE);
  id.append(nonce);
  id
}

#[test_only]
public(package) fun seal_approve_for_testing(
  id: vector<u8>,
  file: &RecipientFile,
  ctx: &TxContext,
) {
  seal_approve(id, file, ctx);
}

#[test_only]
public(package) fun seal_policy_tag_recipient_file_for_testing(): u8 {
  SEAL_POLICY_TAG_RECIPIENT_FILE
}

#[test_only]
public(package) fun seal_approve_with_prefix_for_testing(
  id: vector<u8>,
  file: &RecipientFile,
  ctx: &TxContext,
) {
  seal_approve_with_prefix(id, file, ctx);
}

#[test_only]
public(package) fun build_prefix_seal_id_for_testing(
  prefix: vector<u8>,
  nonce: vector<u8>,
): vector<u8> {
  let mut id = prefix;
  vector::push_back(&mut id, SEAL_POLICY_TAG_RECIPIENT_FILE);
  id.append(nonce);
  id
}
