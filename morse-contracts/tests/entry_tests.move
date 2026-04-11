module publication::entry_tests;

use std::string;
use std::string::String;
use std::unit_test;
use std::unit_test::assert_eq;

use publication::entry;
use publication::entry::BlobRef;

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

#[test_only]
fun blob_ref(ctx: &mut TxContext): (BlobRef, sui::object::UID) {
  let uid = object::new(ctx);
  let br = entry::blob_ref_blob(uid.to_inner());
  (br, uid)
}

#[test_only]
fun fake_patch_id(): vector<u8> {
  vector[
    1u8,2u8,3u8,4u8,5u8,6u8,7u8,8u8,9u8,10u8,11u8,12u8,13u8,14u8,15u8,16u8,
    17u8,18u8,19u8,20u8,21u8,22u8,23u8,24u8,25u8,26u8,27u8,28u8,29u8,30u8,31u8,32u8,
    0u8, 0u8,1u8, 0u8,4u8,
  ]
}

#[test_only]
fun zero_patch_id(): vector<u8> {
  let mut patch_id = vector[];
  let mut i = 0;
  while (i < 37u64) {
    vector::push_back(&mut patch_id, 0u8);
    i = i + 1;
  };
  patch_id
}

#[test]
fun test_new_entry() {
  let ctx = &mut tx_context::dummy();

  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let (br, uid) = blob_ref(ctx);
  let blob_id = uid.to_inner();
  let entry_obj = entry::new_entry_for_testing(
    name,
    br,
    content_type,
    false,
    ctx.sender(),
    entry::access_policy_public(),
    option::none(),
  );

  assert_eq!(entry::get_name(&entry_obj), name);
  assert_eq!(entry::get_content_type(&entry_obj), content_type);
  assert_eq!(entry::get_blob_ref(&entry_obj), entry::blob_ref_blob(blob_id));
  assert_eq!(entry::get_encrypted(&entry_obj), false);
  assert_eq!(entry::get_access_policy(&entry_obj), entry::access_policy_public());
  assert_eq!(option::is_some(&entry::get_seal_id(&entry_obj)), false);

  uid.delete();
  unit_test::destroy(entry_obj);
}

#[test]
fun test_get_name() {
  let ctx = &mut tx_context::dummy();
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let (br, uid) = blob_ref(ctx);
  let entry_obj = entry::new_entry_for_testing(name, br, content_type, false, ctx.sender(), entry::access_policy_public(), option::none());

  assert_eq!(entry::get_name(&entry_obj), name);

  uid.delete();
  unit_test::destroy(entry_obj);
}

#[test]
fun test_get_content_type() {
  let ctx = &mut tx_context::dummy();
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let (br, uid) = blob_ref(ctx);
  let entry_obj = entry::new_entry_for_testing(name, br, content_type, false, ctx.sender(), entry::access_policy_public(), option::none());

  assert_eq!(entry::get_content_type(&entry_obj), content_type);

  uid.delete();
  unit_test::destroy(entry_obj);
}

#[test]
fun test_get_blob_ref() {
  let ctx = &mut tx_context::dummy();
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let (br, uid) = blob_ref(ctx);
  let blob_id = uid.to_inner();
  let entry_obj = entry::new_entry_for_testing(name, br, content_type, false, ctx.sender(), entry::access_policy_public(), option::none());

  assert_eq!(entry::get_blob_ref(&entry_obj), entry::blob_ref_blob(blob_id));

  uid.delete();
  unit_test::destroy(entry_obj);
}

#[test, expected_failure(abort_code = entry::ENameEmpty)]
fun test_new_entry_empty_name_fails() {
  let ctx = &mut tx_context::dummy();
  let (br, uid) = blob_ref(ctx);
  let _entry_obj = entry::new_entry_for_testing(b"".to_string(), br, b"application/json".to_string(), false, ctx.sender(), entry::access_policy_public(), option::none());
  uid.delete();
}

#[test, expected_failure(abort_code = entry::EContentTypeEmpty)]
fun test_new_entry_empty_content_type_fails() {
  let ctx = &mut tx_context::dummy();
  let (br, uid) = blob_ref(ctx);
  let _entry_obj = entry::new_entry_for_testing(b"title".to_string(), br, b"".to_string(), false, ctx.sender(), entry::access_policy_public(), option::none());
  uid.delete();
}

#[test, expected_failure(abort_code = entry::ENameTooLong)]
fun test_new_entry_name_too_long_fails() {
  let ctx = &mut tx_context::dummy();
  let (br, uid) = blob_ref(ctx);
  let long_name = repeated_ascii_string(257, 97);
  let _entry_obj = entry::new_entry_for_testing(long_name, br, b"application/json".to_string(), false, ctx.sender(), entry::access_policy_public(), option::none());
  uid.delete();
}

#[test, expected_failure(abort_code = entry::EContentTypeTooLong)]
fun test_new_entry_content_type_too_long_fails() {
  let ctx = &mut tx_context::dummy();
  let (br, uid) = blob_ref(ctx);
  let long_content_type = repeated_ascii_string(256, 97);
  let _entry_obj = entry::new_entry_for_testing(b"title".to_string(), br, long_content_type, false, ctx.sender(), entry::access_policy_public(), option::none());
  uid.delete();
}

#[test]
fun test_new_entry_max_boundary_lengths_succeed() {
  let ctx = &mut tx_context::dummy();
  let (br, uid) = blob_ref(ctx);
  let max_name = repeated_ascii_string(256, 97);
  let max_content_type = repeated_ascii_string(255, 98);
  let entry_obj = entry::new_entry_for_testing(max_name, br, max_content_type, false, ctx.sender(), entry::access_policy_public(), option::none());

  assert_eq!(entry::get_name(&entry_obj).length(), 256);
  assert_eq!(entry::get_content_type(&entry_obj).length(), 255);

  uid.delete();
  unit_test::destroy(entry_obj);
}

#[test]
fun test_new_encrypted_entry_sets_draft_head() {
  let ctx = &mut tx_context::dummy();
  let (br, uid) = blob_ref(ctx);
  let entry_obj = entry::new_entry_for_testing(
    b"draft".to_string(),
    br,
    b"application/json".to_string(),
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

  uid.delete();
  unit_test::destroy(entry_obj);
}

#[test]
fun test_append_and_publish_revisions() {
  let ctx = &mut tx_context::dummy();
  let uid_0 = object::new(ctx);
  let uid_1 = object::new(ctx);
  let uid_2 = object::new(ctx);

  let mut entry_obj = entry::new_entry_for_testing(
    b"draft".to_string(),
    entry::blob_ref_blob(uid_0.to_inner()),
    b"application/json".to_string(),
    true,
    ctx.sender(),
    entry::access_policy_publisher(),
    option::some(b"draft-0"),
  );
  let draft_rev = entry::append_draft_revision_for_testing(
    &mut entry_obj,
    entry::blob_ref_blob(uid_1.to_inner()),
    b"application/json".to_string(),
    true,
    ctx.sender(),
    entry::access_policy_publisher(),
    option::some(b"draft-1"),
  );
  let public_rev = entry::publish_from_draft_for_testing(
    &mut entry_obj,
    draft_rev,
    entry::blob_ref_blob(uid_2.to_inner()),
    b"application/json".to_string(),
    ctx.sender(),
  );

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

  uid_0.delete();
  uid_1.delete();
  uid_2.delete();
  unit_test::destroy(entry_obj);
}

#[test, expected_failure(abort_code = entry::EInvalidAccessPolicy)]
fun test_new_unencrypted_entry_with_non_public_policy_fails() {
  let ctx = &mut tx_context::dummy();
  let (br, uid) = blob_ref(ctx);
  let _entry_obj = entry::new_entry_for_testing(
    b"bad".to_string(),
    br,
    b"application/json".to_string(),
    false,
    ctx.sender(),
    entry::access_policy_publisher(),
    option::none(),
  );
  uid.delete();
}

#[test, expected_failure(abort_code = entry::ESealIdRequired)]
fun test_new_encrypted_entry_without_seal_id_fails() {
  let ctx = &mut tx_context::dummy();
  let (br, uid) = blob_ref(ctx);
  let _entry_obj = entry::new_entry_for_testing(
    b"bad".to_string(),
    br,
    b"application/json".to_string(),
    true,
    ctx.sender(),
    entry::access_policy_publisher(),
    option::none(),
  );
  uid.delete();
}

#[test, expected_failure(abort_code = entry::ESealIdNotAllowed)]
fun test_new_unencrypted_entry_with_seal_id_fails() {
  let ctx = &mut tx_context::dummy();
  let (br, uid) = blob_ref(ctx);
  let _entry_obj = entry::new_entry_for_testing(
    b"bad".to_string(),
    br,
    b"application/json".to_string(),
    false,
    ctx.sender(),
    entry::access_policy_public(),
    option::some(b"nope"),
  );
  uid.delete();
}

#[test]
fun test_quilt_patch_blob_ref() {
  let ctx = &mut tx_context::dummy();
  let br = entry::blob_ref_quilt_patch(fake_patch_id());
  let entry_obj = entry::new_entry_for_testing(
    b"page".to_string(),
    br,
    b"application/json".to_string(),
    false,
    ctx.sender(),
    entry::access_policy_public(),
    option::none(),
  );

  assert_eq!(entry::get_blob_ref(&entry_obj), entry::blob_ref_quilt_patch(fake_patch_id()));

  unit_test::destroy(entry_obj);
}

#[test, expected_failure(abort_code = entry::EQuiltPatchIdRequired)]
fun test_make_blob_ref_quilt_requires_patch_id() {
  let ctx = &mut tx_context::dummy();
  let uid = object::new(ctx);
  let _br = entry::make_blob_ref_for_testing(1, uid.to_inner(), option::none());
  uid.delete();
}

#[test, expected_failure(abort_code = entry::EQuiltPatchIdNotAllowed)]
fun test_make_blob_ref_blob_rejects_patch_id() {
  let ctx = &mut tx_context::dummy();
  let uid = object::new(ctx);
  let patch_id = option::some(zero_patch_id());
  let _br = entry::make_blob_ref_for_testing(0, uid.to_inner(), patch_id);
  uid.delete();
}

#[test, expected_failure(abort_code = entry::EInvalidQuiltPatchId)]
fun test_make_blob_ref_invalid_patch_id_length() {
  let ctx = &mut tx_context::dummy();
  let uid = object::new(ctx);
  let _br = entry::make_blob_ref_for_testing(1, uid.to_inner(), option::some(b"tooshort"));
  uid.delete();
}
