module publication::allowlist_tests;

use std::unit_test;
use std::unit_test::assert_eq;

use publication::allowlist;

// -- helpers --

#[test_only]
fun setup(ctx: &mut TxContext): (allowlist::Allowlist, allowlist::Cap) {
  allowlist::new_allowlist(b"team-docs".to_string(), ctx)
}

#[test_only]
fun fake_sender_ctx(addr: address): TxContext {
  tx_context::new_from_hint(addr, 0, 0, 0, 0)
}

// -- Allowlist creation + lifecycle --

#[test]
fun new_allowlist() {
  let ctx = &mut tx_context::dummy();
  let (allowlist_obj, cap) = setup(ctx);

  assert_eq!(allowlist::name(&allowlist_obj), b"team-docs".to_string());
  assert_eq!(allowlist::member_count(&allowlist_obj), 0);
  assert_eq!(allowlist::cap_allowlist_id(&cap), object::id(&allowlist_obj));

  unit_test::destroy(allowlist_obj);
  unit_test::destroy(cap);
}

#[test]
fun delete_allowlist() {
  let ctx = &mut tx_context::dummy();
  let (allowlist_obj, cap) = setup(ctx);
  allowlist::delete_allowlist(allowlist_obj, cap);
}

#[test, expected_failure(abort_code = allowlist::EUnauthorized)]
fun delete_allowlist_with_wrong_cap_fails() {
  let ctx = &mut tx_context::dummy();
  let (allowlist_a, cap_a) = setup(ctx);
  let (allowlist_b, cap_b) = allowlist::new_allowlist(b"other".to_string(), ctx);

  // try to delete allowlist_a with cap_b
  allowlist::delete_allowlist(allowlist_a, cap_b);

  unit_test::destroy(allowlist_b);
  unit_test::destroy(cap_a);
}

// -- Members --

#[test]
fun add_member() {
  let ctx = &mut tx_context::dummy();
  let (mut allowlist_obj, cap) = setup(ctx);
  let alice = @0xa11ce;

  assert_eq!(allowlist::is_member(&allowlist_obj, alice), false);
  allowlist::add_member(&mut allowlist_obj, &cap, alice);
  assert_eq!(allowlist::is_member(&allowlist_obj, alice), true);
  assert_eq!(allowlist::member_count(&allowlist_obj), 1);

  unit_test::destroy(allowlist_obj);
  unit_test::destroy(cap);
}

#[test]
fun add_multiple_members() {
  let ctx = &mut tx_context::dummy();
  let (mut allowlist_obj, cap) = setup(ctx);
  allowlist::add_member(&mut allowlist_obj, &cap, @0xa1);
  allowlist::add_member(&mut allowlist_obj, &cap, @0xa2);
  allowlist::add_member(&mut allowlist_obj, &cap, @0xa3);
  assert_eq!(allowlist::member_count(&allowlist_obj), 3);

  unit_test::destroy(allowlist_obj);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = allowlist::EUnauthorized)]
fun add_member_with_wrong_cap_fails() {
  let ctx = &mut tx_context::dummy();
  let (mut allowlist_a, cap_a) = setup(ctx);
  let (allowlist_b, cap_b) = allowlist::new_allowlist(b"other".to_string(), ctx);

  // try to add a member to allowlist_a using cap_b
  allowlist::add_member(&mut allowlist_a, &cap_b, @0xa1);

  unit_test::destroy(allowlist_a);
  unit_test::destroy(cap_a);
  unit_test::destroy(allowlist_b);
  unit_test::destroy(cap_b);
}

#[test, expected_failure(abort_code = allowlist::EMemberAlreadyPresent)]
fun add_duplicate_member_fails() {
  let ctx = &mut tx_context::dummy();
  let (mut allowlist_obj, cap) = setup(ctx);
  allowlist::add_member(&mut allowlist_obj, &cap, @0xa1);
  allowlist::add_member(&mut allowlist_obj, &cap, @0xa1);

  unit_test::destroy(allowlist_obj);
  unit_test::destroy(cap);
}

#[test]
fun remove_member() {
  let ctx = &mut tx_context::dummy();
  let (mut allowlist_obj, cap) = setup(ctx);
  allowlist::add_member(&mut allowlist_obj, &cap, @0xa1);
  allowlist::add_member(&mut allowlist_obj, &cap, @0xa2);
  allowlist::remove_member(&mut allowlist_obj, &cap, @0xa1);

  assert_eq!(allowlist::is_member(&allowlist_obj, @0xa1), false);
  assert_eq!(allowlist::is_member(&allowlist_obj, @0xa2), true);
  assert_eq!(allowlist::member_count(&allowlist_obj), 1);

  unit_test::destroy(allowlist_obj);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = allowlist::EMemberNotPresent)]
fun remove_nonexistent_member_fails() {
  let ctx = &mut tx_context::dummy();
  let (mut allowlist_obj, cap) = setup(ctx);
  allowlist::remove_member(&mut allowlist_obj, &cap, @0xa1);

  unit_test::destroy(allowlist_obj);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = allowlist::EUnauthorized)]
fun remove_member_with_wrong_cap_fails() {
  let ctx = &mut tx_context::dummy();
  let (mut allowlist_a, cap_a) = setup(ctx);
  let (allowlist_b, cap_b) = allowlist::new_allowlist(b"other".to_string(), ctx);
  allowlist::add_member(&mut allowlist_a, &cap_a, @0xa1);

  // try to remove from allowlist_a with cap_b
  allowlist::remove_member(&mut allowlist_a, &cap_b, @0xa1);

  unit_test::destroy(allowlist_a);
  unit_test::destroy(cap_a);
  unit_test::destroy(allowlist_b);
  unit_test::destroy(cap_b);
}

// -- Seal approval --

#[test]
fun seal_approve_for_member() {
  let mut ctx = fake_sender_ctx(@0xa1);
  let (mut allowlist_obj, cap) = allowlist::new_allowlist(b"team".to_string(), &mut ctx);
  allowlist::add_member(&mut allowlist_obj, &cap, @0xa1);

  let id = allowlist::allowlist_seal_id_for_testing(&allowlist_obj, b"nonce-1");
  allowlist::seal_approve_for_testing(id, &allowlist_obj, &ctx);

  unit_test::destroy(allowlist_obj);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = allowlist::ENoAccess)]
fun seal_approve_for_non_member_fails() {
  let mut ctx = fake_sender_ctx(@0xb0b);
  let (allowlist_obj, cap) = allowlist::new_allowlist(b"team".to_string(), &mut ctx);
  // @0xb0b is not a member

  let id = allowlist::allowlist_seal_id_for_testing(&allowlist_obj, b"nonce-1");
  allowlist::seal_approve_for_testing(id, &allowlist_obj, &ctx);

  unit_test::destroy(allowlist_obj);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = allowlist::ESealInvalidId)]
fun seal_approve_with_wrong_namespace_fails() {
  let mut ctx = fake_sender_ctx(@0xa1);
  let (mut allowlist_a, cap_a) = allowlist::new_allowlist(b"a".to_string(), &mut ctx);
  let (allowlist_b, cap_b) = allowlist::new_allowlist(b"b".to_string(), &mut ctx);
  allowlist::add_member(&mut allowlist_a, &cap_a, @0xa1);

  // identity built for allowlist_b but seal_approve called against allowlist_a
  let id = allowlist::allowlist_seal_id_for_testing(&allowlist_b, b"nonce");
  allowlist::seal_approve_for_testing(id, &allowlist_a, &ctx);

  unit_test::destroy(allowlist_a);
  unit_test::destroy(cap_a);
  unit_test::destroy(allowlist_b);
  unit_test::destroy(cap_b);
}

#[test, expected_failure(abort_code = allowlist::ESealWrongPolicyTag)]
fun seal_approve_with_wrong_policy_tag_fails() {
  let mut ctx = fake_sender_ctx(@0xa1);
  let (mut allowlist_obj, cap) = allowlist::new_allowlist(b"team".to_string(), &mut ctx);
  allowlist::add_member(&mut allowlist_obj, &cap, @0xa1);

  // build identity with the wrong policy tag (1 = publisher policy, not allowlist)
  let mut id = object::id(&allowlist_obj).to_bytes();
  vector::push_back(&mut id, 1u8); // publisher tag, not allowlist tag (which is 2)
  id.append(b"nonce");
  allowlist::seal_approve_for_testing(id, &allowlist_obj, &ctx);

  unit_test::destroy(allowlist_obj);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = allowlist::ESealInvalidId)]
fun seal_approve_with_short_id_fails() {
  let mut ctx = fake_sender_ctx(@0xa1);
  let (mut allowlist_obj, cap) = allowlist::new_allowlist(b"team".to_string(), &mut ctx);
  allowlist::add_member(&mut allowlist_obj, &cap, @0xa1);

  // identity shorter than prefix + tag byte
  let id = b"too-short".to_string().into_bytes();
  allowlist::seal_approve_for_testing(id, &allowlist_obj, &ctx);

  unit_test::destroy(allowlist_obj);
  unit_test::destroy(cap);
}

#[test]
fun seal_policy_tag_is_distinct_from_publisher() {
  // Sanity check: allowlist policy tag (2) must differ from publisher tag (1).
  // Co-existence in the same package depends on this.
  assert_eq!(allowlist::seal_policy_tag_allowlist_for_testing(), 2u8);
}
