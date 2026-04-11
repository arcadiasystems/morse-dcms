module publication::entry_tests;

use std::string;
use std::string::String;
use std::unit_test;
use std::unit_test::assert_eq;

use publication::entry;

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

#[test]
fun test_new_entry() {
  let ctx = &mut tx_context::dummy();

  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let mock_blob = object::new(ctx);
  let entry_obj = entry::new_entry(
    name,
    content_type,
    mock_blob.to_inner(),
    false,
    ctx.sender(),
    entry::access_policy_public(),
    option::none(),
  );

  assert_eq!(entry::get_name(&entry_obj), name);
  assert_eq!(entry::get_content_type(&entry_obj), content_type);
  assert_eq!(entry::get_blob(&entry_obj), mock_blob.to_inner());
  assert_eq!(entry::get_encrypted(&entry_obj), false);
  assert_eq!(entry::get_access_policy(&entry_obj), entry::access_policy_public());
  assert_eq!(option::is_some(&entry::get_seal_id(&entry_obj)), false);

  unit_test::destroy(mock_blob);
  unit_test::destroy(entry_obj);
}

#[test]
fun test_get_name() {
  let ctx = &mut tx_context::dummy();
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let blob = object::new(ctx);
  let entry_obj = entry::new_entry(name, content_type, blob.to_inner(), false, ctx.sender(), entry::access_policy_public(), option::none());

  assert_eq!(entry::get_name(&entry_obj), name);

  unit_test::destroy(blob);
  unit_test::destroy(entry_obj);
}

#[test]
fun test_get_content_type() {
  let ctx = &mut tx_context::dummy();
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let blob = object::new(ctx);
  let entry_obj = entry::new_entry(name, content_type, blob.to_inner(), false, ctx.sender(), entry::access_policy_public(), option::none());

  assert_eq!(entry::get_content_type(&entry_obj), content_type);

  unit_test::destroy(blob);
  unit_test::destroy(entry_obj);
}

#[test]
fun test_get_blob() {
  let ctx = &mut tx_context::dummy();
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let blob = object::new(ctx);
  let entry_obj = entry::new_entry(name, content_type, blob.to_inner(), false, ctx.sender(), entry::access_policy_public(), option::none());

  assert_eq!(entry::get_blob(&entry_obj), blob.to_inner());

  unit_test::destroy(blob);
  unit_test::destroy(entry_obj);
}

#[test, expected_failure(abort_code = entry::ENameEmpty)]
fun test_new_entry_empty_name_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let _entry_obj = entry::new_entry(b"".to_string(), b"application/json".to_string(), blob.to_inner(), false, ctx.sender(), entry::access_policy_public(), option::none());
  unit_test::destroy(blob);
}

#[test, expected_failure(abort_code = entry::EContentTypeEmpty)]
fun test_new_entry_empty_content_type_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let _entry_obj = entry::new_entry(b"title".to_string(), b"".to_string(), blob.to_inner(), false, ctx.sender(), entry::access_policy_public(), option::none());
  unit_test::destroy(blob);
}

#[test, expected_failure(abort_code = entry::ENameTooLong)]
fun test_new_entry_name_too_long_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let long_name = repeated_ascii_string(257, 97);
  let _entry_obj = entry::new_entry(long_name, b"application/json".to_string(), blob.to_inner(), false, ctx.sender(), entry::access_policy_public(), option::none());
  unit_test::destroy(blob);
}

#[test, expected_failure(abort_code = entry::EContentTypeTooLong)]
fun test_new_entry_content_type_too_long_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let long_content_type = repeated_ascii_string(256, 97);
  let _entry_obj = entry::new_entry(b"title".to_string(), long_content_type, blob.to_inner(), false, ctx.sender(), entry::access_policy_public(), option::none());
  unit_test::destroy(blob);
}

#[test]
fun test_new_entry_max_boundary_lengths_succeed() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let max_name = repeated_ascii_string(256, 97);
  let max_content_type = repeated_ascii_string(255, 98);
  let entry_obj = entry::new_entry(max_name, max_content_type, blob.to_inner(), false, ctx.sender(), entry::access_policy_public(), option::none());

  assert_eq!(entry::get_name(&entry_obj).length(), 256);
  assert_eq!(entry::get_content_type(&entry_obj).length(), 255);

  unit_test::destroy(blob);
  unit_test::destroy(entry_obj);
}

#[test]
fun test_new_encrypted_entry_sets_draft_head() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let entry_obj = entry::new_entry(
    b"draft".to_string(),
    b"application/json".to_string(),
    blob.to_inner(),
    true,
    ctx.sender(),
    entry::access_policy_publisher(),
    option::some(b"draft-id"),
  );

  assert_eq!(entry::get_encrypted(&entry_obj), true);
  assert_eq!(entry::get_access_policy(&entry_obj), entry::access_policy_publisher());
  assert_eq!(option::is_some(&entry::get_seal_id(&entry_obj)), true);
  assert_eq!(entry::get_draft_head(&entry_obj), option::some(0));
  assert_eq!(entry::get_public_head(&entry_obj), option::none());

  unit_test::destroy(blob);
  unit_test::destroy(entry_obj);
}

#[test]
fun test_append_and_publish_revisions() {
  let ctx = &mut tx_context::dummy();
  let blob_0 = object::new(ctx);
  let blob_1 = object::new(ctx);
  let blob_2 = object::new(ctx);

  let mut entry_obj = entry::new_entry(
    b"draft".to_string(),
    b"application/json".to_string(),
    blob_0.to_inner(),
    true,
    ctx.sender(),
    entry::access_policy_publisher(),
    option::some(b"draft-0"),
  );
  let draft_rev = entry::append_draft_revision(
    &mut entry_obj,
    b"application/json".to_string(),
    blob_1.to_inner(),
    true,
    ctx.sender(),
    entry::access_policy_publisher(),
    option::some(b"draft-1"),
  );
  let public_rev = entry::publish_from_draft(&mut entry_obj, draft_rev, b"application/json".to_string(), blob_2.to_inner(), ctx.sender());

  assert_eq!(draft_rev, 1);
  assert_eq!(public_rev, 2);
  assert_eq!(entry::get_draft_head(&entry_obj), option::some(1));
  assert_eq!(entry::get_public_head(&entry_obj), option::some(2));
  assert_eq!(entry::revision_encrypted(&entry_obj, 2), false);
  assert_eq!(entry::revision_access_policy(&entry_obj, 1), entry::access_policy_publisher());
  assert_eq!(entry::revision_has_seal_id(&entry_obj, 1), true);
  assert_eq!(entry::revision_access_policy(&entry_obj, 2), entry::access_policy_public());
  assert_eq!(entry::revision_has_seal_id(&entry_obj, 2), false);
  assert_eq!(entry::get_author(&entry_obj), ctx.sender());

  unit_test::destroy(blob_0);
  unit_test::destroy(blob_1);
  unit_test::destroy(blob_2);
  unit_test::destroy(entry_obj);
}

#[test, expected_failure(abort_code = entry::EInvalidAccessPolicy)]
fun test_new_unencrypted_entry_with_non_public_policy_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let _entry_obj = entry::new_entry(
    b"bad".to_string(),
    b"application/json".to_string(),
    blob.to_inner(),
    false,
    ctx.sender(),
    entry::access_policy_publisher(),
    option::none(),
  );
  unit_test::destroy(blob);
}

#[test, expected_failure(abort_code = entry::ESealIdRequired)]
fun test_new_encrypted_entry_without_seal_id_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let _entry_obj = entry::new_entry(
    b"bad".to_string(),
    b"application/json".to_string(),
    blob.to_inner(),
    true,
    ctx.sender(),
    entry::access_policy_publisher(),
    option::none(),
  );
  unit_test::destroy(blob);
}

#[test, expected_failure(abort_code = entry::ESealIdNotAllowed)]
fun test_new_unencrypted_entry_with_seal_id_fails() {
  let ctx = &mut tx_context::dummy();
  let blob = object::new(ctx);
  let _entry_obj = entry::new_entry(
    b"bad".to_string(),
    b"application/json".to_string(),
    blob.to_inner(),
    false,
    ctx.sender(),
    entry::access_policy_public(),
    option::some(b"nope"),
  );
  unit_test::destroy(blob);
}
