module publication::collection_tests;

use std::unit_test;
use std::unit_test::assert_eq;

use publication::collection;
use publication::entry;

#[test]
fun new_collection() {
  let ctx = &mut tx_context::dummy();

  let collection_obj = collection::new_collection(b"articles".to_string(), collection::storage_mode_blob(), ctx);

  assert_eq!(collection::name(&collection_obj), b"articles".to_string());
  assert_eq!(collection::storage_mode(&collection_obj), collection::storage_mode_blob());
  assert_eq!(collection::next_entry_id(&collection_obj), 0);

  unit_test::destroy(collection_obj);
}

#[test]
fun new_quilt_collection() {
  let ctx = &mut tx_context::dummy();

  let collection_obj = collection::new_collection(b"pages".to_string(), collection::storage_mode_quilt(), ctx);

  assert_eq!(collection::name(&collection_obj), b"pages".to_string());
  assert_eq!(collection::storage_mode(&collection_obj), collection::storage_mode_quilt());

  unit_test::destroy(collection_obj);
}

#[test, expected_failure(abort_code = collection::EInvalidStorageMode)]
fun invalid_storage_mode_fails() {
  let ctx = &mut tx_context::dummy();
  // Aborts before creating the collection, no cleanup needed.
  let collection_obj = collection::new_collection(b"bad".to_string(), 99, ctx);
  unit_test::destroy(collection_obj);
}

#[test]
fun add_entry() {
  let ctx = &mut tx_context::dummy();

  let mut collection_obj = collection::new_collection(b"articles".to_string(), collection::storage_mode_blob(), ctx);

  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let mock_blob = object::new(ctx);
  let entry_obj = entry::new_entry_for_testing(
    name,
    entry::blob_ref_blob(mock_blob.to_inner()),
    content_type,
    false,
    ctx.sender(),
    entry::access_policy_public(),
    option::none(),
  );

  let entry_id = collection::add_entry(&mut collection_obj, entry_obj);

  assert_eq!(entry_id, 0);
  assert_eq!(collection::contains_entry(&collection_obj, entry_id), true);
  assert_eq!(collection::next_entry_id(&collection_obj), 1);

  mock_blob.delete();
  unit_test::destroy(collection_obj);
}

#[test]
fun delete_entry() {
  let ctx = &mut tx_context::dummy();

  let mut collection_obj = collection::new_collection(b"articles".to_string(), collection::storage_mode_blob(), ctx);

  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let mock_blob = object::new(ctx);
  let entry_obj = entry::new_entry_for_testing(
    name,
    entry::blob_ref_blob(mock_blob.to_inner()),
    content_type,
    false,
    ctx.sender(),
    entry::access_policy_public(),
    option::none(),
  );

  let entry_id = collection::add_entry(&mut collection_obj, entry_obj);

  assert_eq!(entry_id, 0);
  assert_eq!(collection::contains_entry(&collection_obj, entry_id), true);

  collection::delete_entry(&mut collection_obj, entry_id);

  assert_eq!(collection::entries_length(&collection_obj), 0);

  mock_blob.delete();
  unit_test::destroy(collection_obj);
}

#[test]
fun delete_then_add_uses_monotonic_entry_id() {
  let ctx = &mut tx_context::dummy();

  let mut collection_obj = collection::new_collection(b"articles".to_string(), collection::storage_mode_blob(), ctx);

  let blob_0 = object::new(ctx);
  let blob_1 = object::new(ctx);
  let blob_2 = object::new(ctx);
  let blob_3 = object::new(ctx);

  let first_id = collection::add_entry(
    &mut collection_obj,
    entry::new_entry_for_testing(
      b"a".to_string(),
      entry::blob_ref_blob(blob_0.to_inner()),
      b"application/json".to_string(),
      false,
      ctx.sender(),
      entry::access_policy_public(),
      option::none(),
    ),
  );
  let second_id = collection::add_entry(
    &mut collection_obj,
    entry::new_entry_for_testing(
      b"b".to_string(),
      entry::blob_ref_blob(blob_1.to_inner()),
      b"application/json".to_string(),
      false,
      ctx.sender(),
      entry::access_policy_public(),
      option::none(),
    ),
  );
  let third_id = collection::add_entry(
    &mut collection_obj,
    entry::new_entry_for_testing(
      b"c".to_string(),
      entry::blob_ref_blob(blob_2.to_inner()),
      b"application/json".to_string(),
      false,
      ctx.sender(),
      entry::access_policy_public(),
      option::none(),
    ),
  );

  collection::delete_entry(&mut collection_obj, second_id);

  let fourth_id = collection::add_entry(
    &mut collection_obj,
    entry::new_entry_for_testing(
      b"d".to_string(),
      entry::blob_ref_blob(blob_3.to_inner()),
      b"application/json".to_string(),
      false,
      ctx.sender(),
      entry::access_policy_public(),
      option::none(),
    ),
  );

  assert_eq!(collection::entries_length(&collection_obj), 3);
  assert_eq!(first_id, 0);
  assert_eq!(second_id, 1);
  assert_eq!(third_id, 2);
  assert_eq!(fourth_id, 3);
  assert_eq!(collection::contains_entry(&collection_obj, first_id), true);
  assert_eq!(collection::contains_entry(&collection_obj, second_id), false);
  assert_eq!(collection::contains_entry(&collection_obj, third_id), true);
  assert_eq!(collection::contains_entry(&collection_obj, fourth_id), true);
  assert_eq!(collection::next_entry_id(&collection_obj), 4);

  blob_0.delete();
  blob_1.delete();
  blob_2.delete();
  blob_3.delete();
  unit_test::destroy(collection_obj);
}

#[test, expected_failure(abort_code = collection::EEntryNotFound)]
fun delete_missing_entry_id_fails() {
  let ctx = &mut tx_context::dummy();

  let mut collection_obj = collection::new_collection(b"articles".to_string(), collection::storage_mode_blob(), ctx);

  collection::delete_entry(&mut collection_obj, 42);

  unit_test::destroy(collection_obj);
}
