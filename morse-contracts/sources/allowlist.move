/// Module: allowlist.
/// Per-wallet access policy for Seal-encrypted Walrus content. An `Allowlist` is a
/// shared object listing addresses that may decrypt content encrypted under its
/// namespace. Decryption is gated by `seal_approve` which Seal key servers dry-run
/// before releasing key shares.
///
/// The allowlist is independent of the publication concept in this package — it
/// gates files (see `file.move`) by per-wallet membership rather than by
/// PublisherCap. Multiple files can reference the same allowlist; one
/// allowlist + cap manages access for all of them.
module publication::allowlist;

use std::string::String;
use sui::event;
use sui::vec_set::{Self, VecSet};

// -- Allowlist --

/// Shared list of wallet addresses that may decrypt content under this allowlist's
/// Seal namespace. `key` only — sharing and mutation are gated through this
/// module's functions and the matching `Cap`.
public struct Allowlist has key {
  id: UID,
  /// Human-readable name. Not validated; consumers may render it in UI.
  name: String,
  /// Addresses permitted to decrypt. Set-typed to keep membership unique without
  /// scanning. `VecSet` is appropriate for the expected size (tens, not thousands).
  members: VecSet<address>,
}

/// Admin capability for an allowlist. Required to add/remove members, transfer
/// ownership, or delete the allowlist. Bound to `allowlist_id`; cannot be used
/// against a different allowlist.
public struct Cap has key {
  id: UID,
  allowlist_id: ID,
}

/// Create an allowlist and return it together with its admin Cap. The caller is
/// responsible for sharing the allowlist (via `share_allowlist`) and transferring
/// the cap in their PTB. The transaction sender is the initial admin.
public fun new_allowlist(name: String, ctx: &mut TxContext): (Allowlist, Cap) {
  let allowlist = Allowlist {
    id: object::new(ctx),
    name,
    members: vec_set::empty(),
  };
  let allowlist_id = object::id(&allowlist);
  let cap = Cap { id: object::new(ctx), allowlist_id };
  event::emit(AllowlistCreated { allowlist: allowlist_id, name: allowlist.name });
  (allowlist, cap)
}

/// Share an allowlist so it can be referenced by files. Call this in your PTB
/// after `new_allowlist`.
public fun share_allowlist(allowlist: Allowlist) {
  transfer::share_object(allowlist)
}

/// Delete an allowlist. Both objects are consumed. Any `EncryptedFile` still
/// referencing this allowlist will become unusable for decryption (the
/// `seal_approve` dry-run will fail). Callers should delete the dependent
/// files first or migrate them to a different allowlist.
public fun delete_allowlist(allowlist: Allowlist, cap: Cap) {
  let allowlist_id = object::id(&allowlist);
  assert!(cap.allowlist_id == allowlist_id, EUnauthorized);

  let Cap { id: cap_id, allowlist_id: _ } = cap;
  cap_id.delete();
  let Allowlist { id, name, members: _ } = allowlist;
  id.delete();

  event::emit(AllowlistDeleted { allowlist: allowlist_id, name });
}

/// Event emitted on `new_allowlist`.
public struct AllowlistCreated has copy, drop {
  allowlist: ID,
  name: String,
}

/// Event emitted on `delete_allowlist`.
public struct AllowlistDeleted has copy, drop {
  allowlist: ID,
  name: String,
}

// -- Members --

/// Add an address to the allowlist. Idempotent: adding an existing member aborts.
public fun add_member(allowlist: &mut Allowlist, cap: &Cap, addr: address) {
  assert!(cap.allowlist_id == object::id(allowlist), EUnauthorized);
  assert!(!allowlist.members.contains(&addr), EMemberAlreadyPresent);
  allowlist.members.insert(addr);
  event::emit(MemberAdded { allowlist: object::id(allowlist), member: addr });
}

/// Remove an address from the allowlist. Aborts if the address is not a member.
public fun remove_member(allowlist: &mut Allowlist, cap: &Cap, addr: address) {
  assert!(cap.allowlist_id == object::id(allowlist), EUnauthorized);
  assert!(allowlist.members.contains(&addr), EMemberNotPresent);
  allowlist.members.remove(&addr);
  event::emit(MemberRemoved { allowlist: object::id(allowlist), member: addr });
}

/// Transfer admin ownership of an allowlist by transferring its Cap. The new
/// holder gains full admin rights; the previous holder loses them.
public fun transfer_cap(cap: Cap, recipient: address) {
  let allowlist_id = cap.allowlist_id;
  transfer::transfer(cap, recipient);
  event::emit(CapTransferred { allowlist: allowlist_id, recipient });
}

/// Event emitted when an address is added to an allowlist.
public struct MemberAdded has copy, drop {
  allowlist: ID,
  member: address,
}

/// Event emitted when an address is removed from an allowlist.
public struct MemberRemoved has copy, drop {
  allowlist: ID,
  member: address,
}

/// Event emitted when admin Cap ownership transfers.
public struct CapTransferred has copy, drop {
  allowlist: ID,
  recipient: address,
}

/// Error code: cap does not match the supplied allowlist.
const EUnauthorized: u64 = 0;

/// Error code: address is already a member.
const EMemberAlreadyPresent: u64 = 1;

/// Error code: address is not a member.
const EMemberNotPresent: u64 = 2;

// -- Reads --

/// Returns whether `addr` is a member of this allowlist.
public fun is_member(allowlist: &Allowlist, addr: address): bool {
  allowlist.members.contains(&addr)
}

/// Returns the number of members. Useful for UI rendering and gas estimation.
public fun member_count(allowlist: &Allowlist): u64 {
  allowlist.members.length()
}

/// Returns the allowlist name.
public fun get_name(allowlist: &Allowlist): String {
  allowlist.name
}

/// Returns the Cap's bound allowlist id. Useful for client-side validation.
public fun cap_allowlist_id(cap: &Cap): ID {
  cap.allowlist_id
}

// -- Seal (encryption) --

/// Seal access-control entry point. Key servers dry-run this before releasing
/// decryption shares. Identity format expected:
///   [allowlist_id_bytes][SEAL_POLICY_TAG_ALLOWLIST][nonce...]
/// - `allowlist_id_bytes` scopes the identity to this allowlist instance.
/// - `SEAL_POLICY_TAG_ALLOWLIST` separates this policy from `seal_approve_publisher`
///   in the same package (which uses `SEAL_POLICY_TAG_PUBLISHER = 1`).
/// - `nonce` lets many distinct identities exist within one allowlist.
///
/// Aborts unless the sender is a current member of the allowlist AND the identity
/// matches the expected prefix + policy tag.
entry fun seal_approve(id: vector<u8>, allowlist: &Allowlist, ctx: &TxContext) {
  assert_valid_allowlist_seal_id(allowlist, &id);
  assert!(allowlist.members.contains(&ctx.sender()), ENoAccess);
}

/// Seal policy tag for allowlist-gated encrypted content. Distinct from the
/// publisher policy tag (1) in publication.move to keep identity namespaces
/// non-overlapping within this package.
const SEAL_POLICY_TAG_ALLOWLIST: u8 = 2;

/// Error code: provided Seal identity does not match this allowlist namespace.
const ESealInvalidId: u64 = 3;

/// Error code: provided Seal identity has an unsupported policy tag.
const ESealWrongPolicyTag: u64 = 4;

/// Error code: sender is not a member of the allowlist.
const ENoAccess: u64 = 5;

// internal
fun assert_valid_allowlist_seal_id(allowlist: &Allowlist, id: &vector<u8>) {
  let prefix = object::id(allowlist).to_bytes();
  let prefix_len = prefix.length();
  assert!(id.length() > prefix_len + 1, ESealInvalidId);

  let mut i = 0;
  while (i < prefix_len) {
    assert!(*vector::borrow(&prefix, i) == *vector::borrow(id, i), ESealInvalidId);
    i = i + 1;
  };

  assert!(*vector::borrow(id, prefix_len) == SEAL_POLICY_TAG_ALLOWLIST, ESealWrongPolicyTag);
}

#[test_only]
public(package) fun allowlist_seal_id_for_testing(allowlist: &Allowlist, nonce: vector<u8>): vector<u8> {
  let mut id = object::id(allowlist).to_bytes();
  vector::push_back(&mut id, SEAL_POLICY_TAG_ALLOWLIST);
  id.append(nonce);
  id
}

#[test_only]
public(package) fun seal_approve_for_testing(id: vector<u8>, allowlist: &Allowlist, ctx: &TxContext) {
  seal_approve(id, allowlist, ctx);
}

#[test_only]
public(package) fun seal_policy_tag_allowlist_for_testing(): u8 {
  SEAL_POLICY_TAG_ALLOWLIST
}
