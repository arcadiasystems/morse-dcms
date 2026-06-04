module publication::recipient_file_tests;

use std::string;
use std::string::String;
use std::unit_test;
use std::unit_test::assert_eq;

use sui::clock;
use sui::test_scenario;

use publication::recipient_file;

// helpers
// Cross-sender tests use `sui::test_scenario` because `tx_context::sender()`
// reads from a native global rather than the TxContext struct.

#[test_only]
fun repeated_ascii_string(len: u64, byte: u8): String {
  let mut bytes = vector[];
  let mut i = 0;
  while (i < len) {
    vector::push_back(&mut bytes, byte);
    i = i + 1;
  };
  string::utf8(bytes)
}

// -- Creation --

#[test]
fun test_new_recipient_file_auto_adds_sender() {
  let owner = @0xa1;
  let alice = @0xa11ce;
  let bob = @0xb0b;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"walrus-blob-id-bytes",
    option::none(),
    b"tax.pdf".to_string(),
    b"application/pdf".to_string(),
    1234u64,
    vector[alice, bob],
    &clk,
    scenario.ctx(),
  );

  assert_eq!(recipient_file::get_owner(&file), owner);
  assert_eq!(recipient_file::is_recipient(&file, owner), true);
  assert_eq!(recipient_file::is_recipient(&file, alice), true);
  assert_eq!(recipient_file::is_recipient(&file, bob), true);
  assert_eq!(recipient_file::recipient_count(&file), 3);

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test]
fun test_new_recipient_file_deduplicates_recipients() {
  let owner = @0xa1;
  let alice = @0xa11ce;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  // Pass duplicates and a self-reference: sender (owner) AND alice AND alice
  // again should resolve to just {owner, alice}.
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[alice, owner, alice],
    &clk,
    scenario.ctx(),
  );

  assert_eq!(recipient_file::recipient_count(&file), 2);
  assert_eq!(recipient_file::is_recipient(&file, owner), true);
  assert_eq!(recipient_file::is_recipient(&file, alice), true);

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test]
fun test_new_recipient_file_with_empty_recipients_owner_only() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"private.txt".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  assert_eq!(recipient_file::recipient_count(&file), 1);
  assert_eq!(recipient_file::is_recipient(&file, owner), true);

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test, expected_failure(abort_code = recipient_file::EBlobIdEmpty)]
fun test_new_recipient_file_with_empty_blob_id_fails() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let file = recipient_file::new_recipient_file(
    b"",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    ctx,
  );
  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
}

#[test, expected_failure(abort_code = recipient_file::ENameInvalid)]
fun test_new_recipient_file_with_empty_name_fails() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    ctx,
  );
  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
}

#[test, expected_failure(abort_code = recipient_file::ENameInvalid)]
fun test_new_recipient_file_with_too_long_name_fails() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let long_name = repeated_ascii_string(257, 65u8);
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    long_name,
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    ctx,
  );
  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
}

#[test, expected_failure(abort_code = recipient_file::EContentTypeInvalid)]
fun test_new_recipient_file_with_empty_content_type_fails() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"".to_string(),
    1u64,
    vector[],
    &clk,
    ctx,
  );
  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
}

// -- add_recipient / remove_recipient --

#[test]
fun test_add_then_remove_recipient() {
  let owner = @0xa1;
  let later = @0xc0ffee;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let mut file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  recipient_file::add_recipient(&mut file, later, scenario.ctx());
  assert_eq!(recipient_file::is_recipient(&file, later), true);
  assert_eq!(recipient_file::recipient_count(&file), 2);

  recipient_file::remove_recipient(&mut file, later, scenario.ctx());
  assert_eq!(recipient_file::is_recipient(&file, later), false);
  assert_eq!(recipient_file::recipient_count(&file), 1);

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test, expected_failure(abort_code = recipient_file::ERecipientAlreadyPresent)]
fun test_add_duplicate_recipient_fails() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let mut file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[@0xa11ce],
    &clk,
    scenario.ctx(),
  );

  recipient_file::add_recipient(&mut file, @0xa11ce, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test, expected_failure(abort_code = recipient_file::ERecipientNotPresent)]
fun test_remove_nonexistent_recipient_fails() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let mut file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  recipient_file::remove_recipient(&mut file, @0xa11ce, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test, expected_failure(abort_code = recipient_file::EUnauthorized)]
fun test_add_recipient_by_non_owner_fails() {
  let owner = @0xa1;
  let other = @0xb0b;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );
  recipient_file::share_recipient_file(file);

  scenario.next_tx(other);
  let mut shared_file = scenario.take_shared<recipient_file::RecipientFile>();
  recipient_file::add_recipient(&mut shared_file, @0xa11ce, scenario.ctx());

  test_scenario::return_shared(shared_file);
  clock::destroy_for_testing(clk);
  scenario.end();
}

// -- update_metadata / transfer_ownership / delete_file --

#[test]
fun test_update_metadata() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let mut file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"old.txt".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  recipient_file::update_metadata(
    &mut file,
    b"new.md".to_string(),
    b"text/markdown".to_string(),
    scenario.ctx(),
  );

  assert_eq!(recipient_file::get_name(&file), b"new.md".to_string());
  assert_eq!(recipient_file::get_content_type(&file), b"text/markdown".to_string());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test, expected_failure(abort_code = recipient_file::EUnauthorized)]
fun test_update_metadata_by_non_owner_fails() {
  let owner = @0xa1;
  let other = @0xb0b;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );
  recipient_file::share_recipient_file(file);

  scenario.next_tx(other);
  let mut shared = scenario.take_shared<recipient_file::RecipientFile>();
  recipient_file::update_metadata(
    &mut shared,
    b"x".to_string(),
    b"y".to_string(),
    scenario.ctx(),
  );

  test_scenario::return_shared(shared);
  clock::destroy_for_testing(clk);
  scenario.end();
}

#[test]
fun test_transfer_ownership_does_not_touch_members() {
  let owner = @0xa1;
  let new_owner = @0xb0b;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let mut file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[@0xa11ce],
    &clk,
    scenario.ctx(),
  );

  recipient_file::transfer_ownership(&mut file, new_owner, scenario.ctx());

  assert_eq!(recipient_file::get_owner(&file), new_owner);
  // Original owner is STILL in members (handover doesn't auto-remove).
  assert_eq!(recipient_file::is_recipient(&file, owner), true);
  // Alice is still there.
  assert_eq!(recipient_file::is_recipient(&file, @0xa11ce), true);
  // new_owner is NOT auto-added; caller composes add_recipient if needed.
  assert_eq!(recipient_file::is_recipient(&file, new_owner), false);

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test, expected_failure(abort_code = recipient_file::EUnauthorized)]
fun test_transfer_ownership_by_non_owner_fails() {
  let owner = @0xa1;
  let other = @0xb0b;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );
  recipient_file::share_recipient_file(file);

  scenario.next_tx(other);
  let mut shared = scenario.take_shared<recipient_file::RecipientFile>();
  recipient_file::transfer_ownership(&mut shared, @0xc0c, scenario.ctx());

  test_scenario::return_shared(shared);
  clock::destroy_for_testing(clk);
  scenario.end();
}

#[test]
fun test_delete_file() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  recipient_file::delete_file(file, scenario.ctx());
  clock::destroy_for_testing(clk);
  scenario.end();
}

#[test, expected_failure(abort_code = recipient_file::EUnauthorized)]
fun test_delete_file_by_non_owner_fails() {
  let owner = @0xa1;
  let other = @0xb0b;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );
  recipient_file::share_recipient_file(file);

  scenario.next_tx(other);
  let shared = scenario.take_shared<recipient_file::RecipientFile>();
  recipient_file::delete_file(shared, scenario.ctx());

  clock::destroy_for_testing(clk);
  scenario.end();
}

// -- Seal approval --

#[test]
fun test_seal_approve_for_recipient() {
  let owner = @0xa1;
  let recipient = @0xb0b;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[recipient],
    &clk,
    scenario.ctx(),
  );
  recipient_file::share_recipient_file(file);

  scenario.next_tx(recipient);
  let shared = scenario.take_shared<recipient_file::RecipientFile>();
  let id = recipient_file::recipient_file_seal_id_for_testing(&shared, b"nonce");
  recipient_file::seal_approve_for_testing(id, &shared, scenario.ctx());

  test_scenario::return_shared(shared);
  clock::destroy_for_testing(clk);
  scenario.end();
}

#[test]
fun test_seal_approve_for_owner() {
  // Owner is auto-included as a member.
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  let id = recipient_file::recipient_file_seal_id_for_testing(&file, b"nonce");
  recipient_file::seal_approve_for_testing(id, &file, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test, expected_failure(abort_code = recipient_file::ENoAccess)]
fun test_seal_approve_for_non_recipient_fails() {
  let owner = @0xa1;
  let stranger = @0xff;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );
  recipient_file::share_recipient_file(file);

  scenario.next_tx(stranger);
  let shared = scenario.take_shared<recipient_file::RecipientFile>();
  let id = recipient_file::recipient_file_seal_id_for_testing(&shared, b"nonce");
  recipient_file::seal_approve_for_testing(id, &shared, scenario.ctx());

  test_scenario::return_shared(shared);
  clock::destroy_for_testing(clk);
  scenario.end();
}

#[test, expected_failure(abort_code = recipient_file::ESealInvalidId)]
fun test_seal_approve_with_wrong_namespace_fails() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file_a = recipient_file::new_recipient_file(
    b"bytes-a",
    option::none(),
    b"a".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );
  let file_b = recipient_file::new_recipient_file(
    b"bytes-b",
    option::none(),
    b"b".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  // Identity built for file_b but seal_approve called against file_a
  let id = recipient_file::recipient_file_seal_id_for_testing(&file_b, b"nonce");
  recipient_file::seal_approve_for_testing(id, &file_a, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file_a);
  unit_test::destroy(file_b);
  scenario.end();
}

#[test, expected_failure(abort_code = recipient_file::ESealWrongPolicyTag)]
fun test_seal_approve_with_wrong_policy_tag_fails() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  // Build identity with the wrong policy tag (1 = publisher, not 3 = recipient_file)
  let mut id = object::id(&file).to_bytes();
  vector::push_back(&mut id, 1u8);
  id.append(b"nonce");
  recipient_file::seal_approve_for_testing(id, &file, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test, expected_failure(abort_code = recipient_file::ESealInvalidId)]
fun test_seal_approve_with_short_id_fails() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"bytes",
    option::none(),
    b"x".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  let id = b"too-short".to_string().into_bytes();
  recipient_file::seal_approve_for_testing(id, &file, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test]
fun test_seal_policy_tag_is_distinct_from_publisher_and_allowlist() {
  // Coexistence with publisher (1) and allowlist (2) in the same package
  // requires this tag to be 3.
  assert_eq!(recipient_file::seal_policy_tag_recipient_file_for_testing(), 3u8);
}

// -- Seal with caller-supplied prefix --

#[test]
fun test_new_with_seal_prefix_attaches_prefix_and_seal_approve_with_prefix_succeeds() {
  let owner = @0xa1;
  let alice = @0xa11ce;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let prefix = b"prefix-bytes-32-random-aaaaaaaaaaaa";
  let file = recipient_file::new_recipient_file_with_seal_prefix(
    prefix,
    b"walrus-blob-id-bytes",
    option::none(),
    b"tax.pdf".to_string(),
    b"application/pdf".to_string(),
    1234u64,
    vector[alice],
    &clk,
    scenario.ctx(),
  );

  let stored_prefix = recipient_file::get_seal_id_prefix(&file);
  assert_eq!(option::is_some(&stored_prefix), true);
  assert_eq!(*option::borrow(&stored_prefix), prefix);

  let id = recipient_file::build_prefix_seal_id_for_testing(prefix, b"nonce-1");
  recipient_file::seal_approve_with_prefix_for_testing(id, &file, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test]
fun test_get_seal_id_prefix_returns_none_for_legacy_files() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"blob",
    option::none(),
    b"n".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  let stored_prefix = recipient_file::get_seal_id_prefix(&file);
  assert_eq!(option::is_none(&stored_prefix), true);

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 9, location = recipient_file)]
fun test_new_with_seal_prefix_aborts_on_empty_prefix() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file_with_seal_prefix(
    b"",
    b"blob",
    option::none(),
    b"n".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 10, location = recipient_file)]
fun test_seal_approve_with_prefix_aborts_when_no_prefix_attached() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file(
    b"blob",
    option::none(),
    b"n".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  // Build a syntactically valid id (any prefix + tag + nonce); the dynamic
  // field lookup must fail before the prefix check runs.
  let id = recipient_file::build_prefix_seal_id_for_testing(b"anything", b"x");
  recipient_file::seal_approve_with_prefix_for_testing(id, &file, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 6, location = recipient_file)]
fun test_seal_approve_with_prefix_aborts_when_id_does_not_match_prefix() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file = recipient_file::new_recipient_file_with_seal_prefix(
    b"prefix-A-bytes",
    b"blob",
    option::none(),
    b"n".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  let id = recipient_file::build_prefix_seal_id_for_testing(b"prefix-B-bytes", b"x");
  recipient_file::seal_approve_with_prefix_for_testing(id, &file, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 8, location = recipient_file)]
fun test_seal_approve_with_prefix_aborts_when_sender_is_not_recipient() {
  let owner = @0xa1;
  let intruder = @0xfade;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let prefix = b"prefix-bytes";
  let file = recipient_file::new_recipient_file_with_seal_prefix(
    prefix,
    b"blob",
    option::none(),
    b"n".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  scenario.next_tx(intruder);
  let id = recipient_file::build_prefix_seal_id_for_testing(prefix, b"nonce");
  recipient_file::seal_approve_with_prefix_for_testing(id, &file, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 7, location = recipient_file)]
fun test_seal_approve_with_prefix_aborts_on_wrong_policy_tag() {
  let owner = @0xa1;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let prefix = b"prefix-bytes";
  let file = recipient_file::new_recipient_file_with_seal_prefix(
    prefix,
    b"blob",
    option::none(),
    b"n".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  // Hand-craft an id with tag=1 (publisher) instead of 3 (recipient_file).
  let mut id = prefix;
  vector::push_back(&mut id, 1u8);
  vector::append(&mut id, b"nonce");
  recipient_file::seal_approve_with_prefix_for_testing(id, &file, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}

#[test]
fun test_owner_can_add_recipient_then_seal_approve_with_prefix_passes_for_new_member() {
  let owner = @0xa1;
  let new_member = @0xb0b;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let prefix = b"prefix-bytes";
  let mut file = recipient_file::new_recipient_file_with_seal_prefix(
    prefix,
    b"blob",
    option::none(),
    b"n".to_string(),
    b"text/plain".to_string(),
    1u64,
    vector[],
    &clk,
    scenario.ctx(),
  );

  recipient_file::add_recipient(&mut file, new_member, scenario.ctx());

  scenario.next_tx(new_member);
  let id = recipient_file::build_prefix_seal_id_for_testing(prefix, b"nonce");
  recipient_file::seal_approve_with_prefix_for_testing(id, &file, scenario.ctx());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file);
  scenario.end();
}
