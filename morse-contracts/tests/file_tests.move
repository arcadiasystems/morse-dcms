module publication::file_tests;

use std::string;
use std::string::String;
use std::unit_test;
use std::unit_test::assert_eq;

use sui::clock;
use sui::test_scenario;

use publication::file;

// -- helpers --
// Cross-sender tests use `test_scenario` because `tx_context::sender()` reads
// from a native global rather than the TxContext struct, so creating multiple
// TxContexts with different addresses does not actually switch senders.
// Single-sender tests stay on `tx_context::dummy()` for brevity (the native
// sender default is `@0x0`).

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

// -- Encrypted file creation --

#[test]
fun test_new_encrypted_file() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let fake_allowlist_id = object::id_from_address(@0xa110);

  let file_obj = file::new_encrypted_file(
    b"walrus-blob-id-bytes",
    option::some(object::id_from_address(@0xb10b)),
    b"tax-2026.pdf".to_string(),
    b"application/pdf".to_string(),
    12345u64,
    fake_allowlist_id,
    &clk,
    ctx,
  );

  assert_eq!(file::get_blob_id(&file_obj), b"walrus-blob-id-bytes");
  assert_eq!(file::get_name(&file_obj), b"tax-2026.pdf".to_string());
  assert_eq!(file::get_content_type(&file_obj), b"application/pdf".to_string());
  assert_eq!(file::get_size(&file_obj), 12345u64);
  assert_eq!(file::is_encrypted(&file_obj), true);
  assert_eq!(file::get_allowlist_id(&file_obj), option::some(fake_allowlist_id));

  clock::destroy_for_testing(clk);
  unit_test::destroy(file_obj);
}

#[test]
fun test_new_public_file_has_no_allowlist() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);

  let file_obj = file::new_public_file(
    b"walrus-blob-id-bytes",
    option::none(),
    b"logo.png".to_string(),
    b"image/png".to_string(),
    2048u64,
    &clk,
    ctx,
  );

  assert_eq!(file::is_encrypted(&file_obj), false);
  assert_eq!(file::get_allowlist_id(&file_obj), option::none());
  assert_eq!(file::get_blob_object_id(&file_obj), option::none());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file_obj);
}

#[test, expected_failure(abort_code = file::EBlobIdEmpty)]
fun test_create_file_with_empty_blob_id_fails() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let file_obj = file::new_public_file(
    b"",
    option::none(),
    b"name".to_string(),
    b"text/plain".to_string(),
    1u64,
    &clk,
    ctx,
  );
  clock::destroy_for_testing(clk);
  unit_test::destroy(file_obj);
}

#[test, expected_failure(abort_code = file::ENameInvalid)]
fun test_create_file_with_empty_name_fails() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let file_obj = file::new_public_file(
    b"bytes",
    option::none(),
    b"".to_string(),
    b"text/plain".to_string(),
    1u64,
    &clk,
    ctx,
  );
  clock::destroy_for_testing(clk);
  unit_test::destroy(file_obj);
}

#[test, expected_failure(abort_code = file::ENameInvalid)]
fun test_create_file_with_too_long_name_fails() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let long_name = repeated_ascii_string(257, 65u8); // 257 'A's, exceeds MAX_NAME_LENGTH
  let file_obj = file::new_public_file(
    b"bytes",
    option::none(),
    long_name,
    b"text/plain".to_string(),
    1u64,
    &clk,
    ctx,
  );
  clock::destroy_for_testing(clk);
  unit_test::destroy(file_obj);
}

#[test, expected_failure(abort_code = file::EContentTypeInvalid)]
fun test_create_file_with_empty_content_type_fails() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let file_obj = file::new_public_file(
    b"bytes",
    option::none(),
    b"name".to_string(),
    b"".to_string(),
    1u64,
    &clk,
    ctx,
  );
  clock::destroy_for_testing(clk);
  unit_test::destroy(file_obj);
}

#[test, expected_failure(abort_code = file::EContentTypeInvalid)]
fun test_create_file_with_too_long_content_type_fails() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let long_ct = repeated_ascii_string(256, 65u8); // exceeds MAX_CONTENT_TYPE_LENGTH (255)
  let file_obj = file::new_public_file(
    b"bytes",
    option::none(),
    b"name".to_string(),
    long_ct,
    1u64,
    &clk,
    ctx,
  );
  clock::destroy_for_testing(clk);
  unit_test::destroy(file_obj);
}

// -- update_metadata --

#[test]
fun test_update_metadata() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let mut file_obj = file::new_public_file(
    b"bytes",
    option::none(),
    b"old.txt".to_string(),
    b"text/plain".to_string(),
    1u64,
    &clk,
    ctx,
  );

  file::update_metadata(&mut file_obj, b"new.md".to_string(), b"text/markdown".to_string(), ctx);

  assert_eq!(file::get_name(&file_obj), b"new.md".to_string());
  assert_eq!(file::get_content_type(&file_obj), b"text/markdown".to_string());

  clock::destroy_for_testing(clk);
  unit_test::destroy(file_obj);
}

#[test, expected_failure(abort_code = file::EUnauthorized)]
fun test_update_metadata_by_non_owner_fails() {
  let owner = @0xa1;
  let other = @0xb0b;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file_obj = file::new_public_file(
    b"bytes",
    option::none(),
    b"old.txt".to_string(),
    b"text/plain".to_string(),
    1u64,
    &clk,
    scenario.ctx(),
  );
  file::share_file(file_obj);

  scenario.next_tx(other);
  let mut shared_file = scenario.take_shared<file::EncryptedFile>();
  file::update_metadata(&mut shared_file, b"x".to_string(), b"y".to_string(), scenario.ctx());

  test_scenario::return_shared(shared_file);
  clock::destroy_for_testing(clk);
  scenario.end();
}

#[test, expected_failure(abort_code = file::ENameInvalid)]
fun test_update_metadata_with_empty_name_fails() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let mut file_obj = file::new_public_file(
    b"bytes",
    option::none(),
    b"name".to_string(),
    b"text/plain".to_string(),
    1u64,
    &clk,
    ctx,
  );

  file::update_metadata(&mut file_obj, b"".to_string(), b"text/plain".to_string(), ctx);

  clock::destroy_for_testing(clk);
  unit_test::destroy(file_obj);
}

// -- transfer_ownership --

#[test]
fun test_transfer_ownership() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let mut file_obj = file::new_public_file(
    b"bytes",
    option::none(),
    b"name".to_string(),
    b"text/plain".to_string(),
    1u64,
    &clk,
    ctx,
  );

  file::transfer_ownership(&mut file_obj, @0xb0b, ctx);

  assert_eq!(file::get_owner(&file_obj), @0xb0b);

  clock::destroy_for_testing(clk);
  unit_test::destroy(file_obj);
}

#[test, expected_failure(abort_code = file::EUnauthorized)]
fun test_transfer_ownership_by_non_owner_fails() {
  let owner = @0xa1;
  let other = @0xb0b;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file_obj = file::new_public_file(
    b"bytes",
    option::none(),
    b"name".to_string(),
    b"text/plain".to_string(),
    1u64,
    &clk,
    scenario.ctx(),
  );
  file::share_file(file_obj);

  scenario.next_tx(other);
  let mut shared_file = scenario.take_shared<file::EncryptedFile>();
  file::transfer_ownership(&mut shared_file, @0xc0c, scenario.ctx());

  test_scenario::return_shared(shared_file);
  clock::destroy_for_testing(clk);
  scenario.end();
}

// -- delete_file --

#[test]
fun test_delete_file() {
  let ctx = &mut tx_context::dummy();
  let clk = clock::create_for_testing(ctx);
  let file_obj = file::new_public_file(
    b"bytes",
    option::none(),
    b"name".to_string(),
    b"text/plain".to_string(),
    1u64,
    &clk,
    ctx,
  );

  file::delete_file(file_obj, ctx);
  clock::destroy_for_testing(clk);
}

#[test, expected_failure(abort_code = file::EUnauthorized)]
fun test_delete_file_by_non_owner_fails() {
  let owner = @0xa1;
  let other = @0xb0b;
  let mut scenario = test_scenario::begin(owner);

  let clk = clock::create_for_testing(scenario.ctx());
  let file_obj = file::new_public_file(
    b"bytes",
    option::none(),
    b"name".to_string(),
    b"text/plain".to_string(),
    1u64,
    &clk,
    scenario.ctx(),
  );
  file::share_file(file_obj);

  scenario.next_tx(other);
  let shared_file = scenario.take_shared<file::EncryptedFile>();
  file::delete_file(shared_file, scenario.ctx());

  clock::destroy_for_testing(clk);
  scenario.end();
}
