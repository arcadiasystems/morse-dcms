/// Module: file.
/// On-chain metadata for files stored on Walrus, with optional Seal-gated access
/// via an `Allowlist` (see `allowlist.move`).
///
/// Walrus stores raw bytes only and has no native notion of filename, MIME type,
/// or owner — this module holds those metadata fields on-chain and references the
/// Walrus blob by `blob_id` (and optionally the on-chain `Blob` object id). It
/// does NOT manage Walrus storage payment or renewal; blob lifetime is the
/// Walrus lease.
///
/// Encrypted files reference an `Allowlist`. Decryption access is gated by the
/// allowlist's `seal_approve` entry function (see `allowlist.move`). Public
/// (unencrypted) files set `encrypted = false` and `allowlist_id = none`; they
/// are just metadata records pointing at a public Walrus blob.
module publication::file;

use std::string::String;
use sui::clock::Clock;
use sui::event;

// -- File metadata --

/// On-chain record of one file stored on Walrus. `key` only — sharing is
/// controlled through this module's functions, mutations are owner-gated.
public struct EncryptedFile has key {
  id: UID,
  /// Address that may mutate metadata, transfer ownership, and delete the record.
  /// Decryption access is governed separately by the referenced `Allowlist`.
  owner: address,
  /// Walrus content id (CID) of the stored bytes. Required for all files.
  blob_id: vector<u8>,
  /// On-chain Walrus `Blob` object id when known. Optional because some flows
  /// (HTTP publisher uploads, third-party-certified blobs) do not yield an
  /// owned Blob object on the consumer's address.
  blob_object_id: Option<ID>,
  /// Original filename, e.g. "tax-return-2026.pdf".
  name: String,
  /// MIME type, e.g. "application/pdf". Lowercase recommended; not enforced.
  content_type: String,
  /// Size in bytes of the original plaintext (encrypted files) or the stored
  /// bytes (public files). Useful for UI but not validated against Walrus.
  size: u64,
  /// Whether the bytes on Walrus are Seal-encrypted under `allowlist_id`.
  encrypted: bool,
  /// Allowlist gating decryption. Required when `encrypted = true`, must be
  /// `none` when `encrypted = false`. The allowlist itself lives in a separate
  /// shared object; this is a reference only.
  allowlist_id: Option<ID>,
  /// Sui-clock timestamp at creation, in milliseconds since unix epoch. Set
  /// once at create and never updated; use it for ordering, not for editing
  /// timestamps.
  created_at_ms: u64,
}

/// Create an encrypted file metadata record. The caller is responsible for
/// having already uploaded the encrypted bytes to Walrus under the same
/// `allowlist_id`'s Seal identity namespace.
///
/// Aborts on empty `blob_id`, empty `name`, or empty `content_type`. The
/// `allowlist_id` argument must be `some(...)` for encrypted files; use
/// `new_public_file` for unencrypted ones.
public fun new_encrypted_file(
  blob_id: vector<u8>,
  blob_object_id: Option<ID>,
  name: String,
  content_type: String,
  size: u64,
  allowlist_id: ID,
  clock: &Clock,
  ctx: &mut TxContext,
): EncryptedFile {
  assert_valid_blob_id(&blob_id);
  assert_valid_name(&name);
  assert_valid_content_type(&content_type);
  let file = EncryptedFile {
    id: object::new(ctx),
    owner: ctx.sender(),
    blob_id,
    blob_object_id,
    name,
    content_type,
    size,
    encrypted: true,
    allowlist_id: option::some(allowlist_id),
    created_at_ms: clock.timestamp_ms(),
  };
  event::emit(FileCreated {
    file: object::id(&file),
    owner: file.owner,
    allowlist_id: option::some(allowlist_id),
    encrypted: true,
    name: file.name,
    content_type: file.content_type,
    size,
  });
  file
}

/// Create a public file metadata record. Bytes on Walrus are unencrypted and
/// readable by anyone with the aggregator. Aborts on empty fields.
public fun new_public_file(
  blob_id: vector<u8>,
  blob_object_id: Option<ID>,
  name: String,
  content_type: String,
  size: u64,
  clock: &Clock,
  ctx: &mut TxContext,
): EncryptedFile {
  assert_valid_blob_id(&blob_id);
  assert_valid_name(&name);
  assert_valid_content_type(&content_type);
  let file = EncryptedFile {
    id: object::new(ctx),
    owner: ctx.sender(),
    blob_id,
    blob_object_id,
    name,
    content_type,
    size,
    encrypted: false,
    allowlist_id: option::none(),
    created_at_ms: clock.timestamp_ms(),
  };
  event::emit(FileCreated {
    file: object::id(&file),
    owner: file.owner,
    allowlist_id: option::none(),
    encrypted: false,
    name: file.name,
    content_type: file.content_type,
    size,
  });
  file
}

/// Share the file so its allowlist can gate decryption from any wallet.
/// Call this in your PTB after `new_encrypted_file` / `new_public_file`.
public fun share_file(file: EncryptedFile) {
  transfer::share_object(file)
}

/// Delete a file metadata record. Does NOT delete the Walrus blob; that follows
/// the Walrus lease lifecycle independently. Owner only.
public fun delete_file(file: EncryptedFile, ctx: &TxContext) {
  assert!(file.owner == ctx.sender(), EUnauthorized);
  let file_id = object::id(&file);
  let EncryptedFile {
    id,
    owner: _,
    blob_id: _,
    blob_object_id: _,
    name,
    content_type: _,
    size: _,
    encrypted: _,
    allowlist_id: _,
    created_at_ms: _,
  } = file;
  id.delete();
  event::emit(FileDeleted { file: file_id, name });
}

/// Update the file's `name` and `content_type`. Other fields (blob, allowlist,
/// owner, timestamps) are immutable post-creation; create a new record if you
/// need to swap the blob or change the policy. Owner only.
public fun update_metadata(
  file: &mut EncryptedFile,
  name: String,
  content_type: String,
  ctx: &TxContext,
) {
  assert!(file.owner == ctx.sender(), EUnauthorized);
  assert_valid_name(&name);
  assert_valid_content_type(&content_type);
  file.name = name;
  file.content_type = content_type;
  event::emit(FileMetadataUpdated {
    file: object::id(file),
    name: file.name,
    content_type: file.content_type,
  });
}

/// Transfer ownership of the metadata record to a new address. Note: this
/// transfers ONLY the right to mutate/delete metadata. Decryption access is
/// governed by the file's referenced allowlist; the new owner must additionally
/// be added to that allowlist (and the previous owner removed, if desired) by
/// the allowlist's admin Cap holder. The two operations can be composed in a
/// single PTB by the caller.
public fun transfer_ownership(file: &mut EncryptedFile, new_owner: address, ctx: &TxContext) {
  assert!(file.owner == ctx.sender(), EUnauthorized);
  let previous = file.owner;
  file.owner = new_owner;
  event::emit(FileOwnershipTransferred {
    file: object::id(file),
    previous_owner: previous,
    new_owner,
  });
}

/// Event emitted on file creation. The `allowlist_id` is `some(...)` for
/// encrypted files, `none` for public ones; indexers can branch on this to list
/// "files I own (any kind)" vs "files I can decrypt (allowlist membership)".
public struct FileCreated has copy, drop {
  file: ID,
  owner: address,
  allowlist_id: Option<ID>,
  encrypted: bool,
  name: String,
  content_type: String,
  size: u64,
}

/// Event emitted when a file is deleted.
public struct FileDeleted has copy, drop {
  file: ID,
  name: String,
}

/// Event emitted when a file's `name` or `content_type` is updated.
public struct FileMetadataUpdated has copy, drop {
  file: ID,
  name: String,
  content_type: String,
}

/// Event emitted when a file's `owner` is transferred.
public struct FileOwnershipTransferred has copy, drop {
  file: ID,
  previous_owner: address,
  new_owner: address,
}

/// Error code: sender is not the file owner.
const EUnauthorized: u64 = 0;

/// Error code: `blob_id` must be non-empty.
const EBlobIdEmpty: u64 = 1;

/// Error code: `name` must be non-empty and within the max length.
const ENameInvalid: u64 = 2;

/// Error code: `content_type` must be non-empty and within the max length.
const EContentTypeInvalid: u64 = 3;

/// Maximum allowed filename length. Same bound as `entry::ENameTooLong` for
/// consistency across the package.
const MAX_NAME_LENGTH: u64 = 256;

/// Maximum allowed content-type length. Same bound as `entry::EContentTypeTooLong`.
const MAX_CONTENT_TYPE_LENGTH: u64 = 255;

// -- Reads --

public fun get_owner(file: &EncryptedFile): address { file.owner }
public fun get_blob_id(file: &EncryptedFile): vector<u8> { file.blob_id }
public fun get_blob_object_id(file: &EncryptedFile): Option<ID> { file.blob_object_id }
public fun get_name(file: &EncryptedFile): String { file.name }
public fun get_content_type(file: &EncryptedFile): String { file.content_type }
public fun get_size(file: &EncryptedFile): u64 { file.size }
public fun is_encrypted(file: &EncryptedFile): bool { file.encrypted }
public fun get_allowlist_id(file: &EncryptedFile): Option<ID> { file.allowlist_id }
public fun get_created_at_ms(file: &EncryptedFile): u64 { file.created_at_ms }

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
