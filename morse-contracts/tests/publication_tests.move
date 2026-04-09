module publication::publication_tests;

use std::unit_test;
use std::unit_test::assert_eq;

use publication::collection;
use publication::entry;
use publication::publication;

#[test]
fun test_new_publication() {
  let ctx = &mut tx_context::dummy();
  let publication_name = b"ArcSys Blog".to_string();

  let (publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, publication_name);

  assert_eq!(publication::name(&publication_obj), publication_name);
  assert_eq!(publication::slug(&publication_obj), b"test-slug".to_string());
  assert_eq!(publication::owner_cap_publication_id(&owner_cap), object::id(&publication_obj));
  assert_eq!(publication::publisher_cap_publication_id(&publisher_cap), object::id(&publication_obj));
  assert_eq!(publication::publisher_cap_holder(&publisher_cap), ctx.sender());

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_slug_registry_lookup() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);
  let (publication_obj, owner_cap, publisher_cap) = publication::new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"ArcSys Blog".to_string(),
    b"my-personal-blog".to_string(),
  );

  assert_eq!(publication::contains_slug(&registry, b"my-personal-blog".to_string()), true);
  assert_eq!(
    *publication::get_publication_id_by_slug(&registry, b"my-personal-blog".to_string()),
    object::id(&publication_obj),
  );

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = publication::ESlugAlreadyExists)]
fun test_duplicate_slug_fails() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);

  let (publication_obj, owner_cap, publisher_cap) = publication::new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"ArcSys Blog".to_string(),
    b"my-personal-blog".to_string(),
  );

  let (_other_publication, _other_owner_cap, _other_publisher_cap) = publication::new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"Other".to_string(),
    b"my-personal-blog".to_string(),
  );

  unit_test::destroy(_other_publication);
  unit_test::destroy(_other_owner_cap);
  unit_test::destroy(_other_publisher_cap);
  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = publication::ESlugInvalidChar)]
fun test_invalid_slug_fails() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);
  let (publication_obj, owner_cap, publisher_cap) = publication::new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"ArcSys Blog".to_string(),
    b"My-Personal-Blog".to_string(),
  );
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(registry);
}

#[test]
fun test_slug_reusable_after_delete() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);

  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"ArcSys Blog".to_string(),
    b"my-personal-blog".to_string(),
  );

  publication::destroy_publisher_cap(&mut publication_obj, publisher_cap, ctx);
  publication::delete_publication(&mut registry, publication_obj, owner_cap);
  assert_eq!(publication::contains_slug(&registry, b"my-personal-blog".to_string()), false);

  let (publication_obj_2, owner_cap_2, publisher_cap_2) = publication::new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"ArcSys Blog v2".to_string(),
    b"my-personal-blog".to_string(),
  );

  assert_eq!(publication::contains_slug(&registry, b"my-personal-blog".to_string()), true);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj_2);
  unit_test::destroy(owner_cap_2);
  unit_test::destroy(publisher_cap_2);
}

#[test]
fun test_delete_publication() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_with_registry_for_testing(
    &mut registry,
    ctx,
    b"ArcSys Blog".to_string(),
    b"delete-me".to_string(),
  );

  publication::destroy_publisher_cap(&mut publication_obj, publisher_cap, ctx);
  publication::delete_publication(&mut registry, publication_obj, owner_cap);

  unit_test::destroy(registry);
}

#[test]
fun test_issue_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let new_cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);

  assert_eq!(publication::publisher_cap_publication_id(&new_cap), object::id(&publication_obj));
  assert_eq!(publication::publisher_cap_holder(&new_cap), ctx.sender());

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(new_cap);
}

#[test]
fun test_destroy_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  publication::destroy_publisher_cap(&mut publication_obj, publisher_cap, ctx);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
}

#[test, expected_failure(abort_code = publication::EPublisherCapWrongHolder)]
fun test_wrong_holder_cannot_use_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let other_holder = @0xB;
  let other_cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, other_holder, ctx);

  let collection_obj = collection::new_collection(object::id(&publication_obj), b"articles".to_string(), ctx);
  publication::add_collection(&mut publication_obj, &other_cap, collection_obj, ctx);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_cap);
}

#[test, expected_failure(abort_code = publication::EPublisherCapWrongHolder)]
fun test_wrong_holder_cannot_destroy_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let other_cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, @0xB, ctx);

  publication::destroy_publisher_cap(&mut publication_obj, other_cap, ctx);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_owner_can_revoke_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  publication::revoke_publisher_cap(&mut publication_obj, &owner_cap, cap_id);

  assert_eq!(publication::contains_active_publisher_cap(&publication_obj, cap_id), false);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = publication::EPublisherCapNotActive)]
fun test_revoked_cap_cannot_write() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  publication::revoke_publisher_cap(&mut publication_obj, &owner_cap, cap_id);

  let collection_obj = collection::new_collection(object::id(&publication_obj), b"articles".to_string(), ctx);
  publication::add_collection(&mut publication_obj, &cap, collection_obj, ctx);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = publication::EUnauthorized)]
fun test_wrong_owner_cannot_revoke_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let (other_publication, other_owner_cap, other_publisher_cap) = publication::new_publication_for_testing(ctx, b"Other".to_string());
  let cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  publication::revoke_publisher_cap(&mut publication_obj, &other_owner_cap, cap_id);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_publication);
  unit_test::destroy(other_owner_cap);
  unit_test::destroy(other_publisher_cap);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = publication::EPublisherCapNotActive)]
fun test_revoke_nonexistent_cap_fails() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let fake_cap = object::new(ctx);

  publication::revoke_publisher_cap(&mut publication_obj, &owner_cap, fake_cap.to_inner());

  unit_test::destroy(fake_cap);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_destroy_revoked_cap_succeeds() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  publication::revoke_publisher_cap(&mut publication_obj, &owner_cap, cap_id);
  publication::destroy_publisher_cap(&mut publication_obj, cap, ctx);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_add_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection_obj = collection::new_collection(object::id(&publication_obj), collection_name, ctx);

  publication::add_collection(&mut publication_obj, &publisher_cap, collection_obj, ctx);

  assert_eq!(publication::collections_length(&publication_obj), 1);
  assert_eq!(publication::contains_collection(&publication_obj, collection_name), true);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_create_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  publication::create_collection(&mut publication_obj, &publisher_cap, b"articles".to_string(), ctx);

  assert_eq!(publication::collections_length(&publication_obj), 1);
  assert_eq!(publication::contains_collection(&publication_obj, b"articles".to_string()), true);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = publication::ECollectionAlreadyExists)]
fun test_add_duplicate_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_obj = collection::new_collection(object::id(&publication_obj), b"articles".to_string(), ctx);
  let duplicate = collection::new_collection(object::id(&publication_obj), b"articles".to_string(), ctx);

  publication::add_collection(&mut publication_obj, &publisher_cap, collection_obj, ctx);
  publication::add_collection(&mut publication_obj, &publisher_cap, duplicate, ctx);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_delete_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection_obj = collection::new_collection(object::id(&publication_obj), collection_name, ctx);

  publication::add_collection(&mut publication_obj, &publisher_cap, collection_obj, ctx);
  assert_eq!(publication::collections_length(&publication_obj), 1);

  publication::delete_collection(&mut publication_obj, &publisher_cap, collection_name, ctx);
  assert_eq!(publication::collections_length(&publication_obj), 0);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_publisher_can_add_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, root_publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let publisher_cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  let collection_obj = collection::new_collection(object::id(&publication_obj), b"articles".to_string(), ctx);

  publication::add_collection(&mut publication_obj, &publisher_cap, collection_obj, ctx);

  assert_eq!(publication::collections_length(&publication_obj), 1);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(root_publisher_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = publication::EUnauthorized)]
fun test_unauthorized_add_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let (other_pub, other_owner_cap, other_publisher_cap) = publication::new_publication_for_testing(ctx, b"Other".to_string());
  let collection_obj = collection::new_collection(object::id(&publication_obj), b"articles".to_string(), ctx);

  publication::add_collection(&mut publication_obj, &other_publisher_cap, collection_obj, ctx);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_pub);
  unit_test::destroy(other_owner_cap);
  unit_test::destroy(other_publisher_cap);
}

#[test, expected_failure(abort_code = publication::ECollectionPublicationMismatch)]
fun test_add_collection_with_mismatched_publication_id() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());
  let (other_publication, other_owner_cap, other_publisher_cap) = publication::new_publication_for_testing(ctx, b"Other".to_string());

  let collection_obj = collection::new_collection(object::id(&other_publication), b"articles".to_string(), ctx);

  publication::add_collection(&mut publication_obj, &publisher_cap, collection_obj, ctx);

  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_publication);
  unit_test::destroy(other_owner_cap);
  unit_test::destroy(other_publisher_cap);
}

#[test, expected_failure(abort_code = publication::EEntryAuthorMismatch)]
fun test_add_entry_to_collection_with_mismatched_author_fails() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"home_page".to_string();
  publication::create_collection(&mut publication_obj, &publisher_cap, collection_name, ctx);

  let mock_blob = object::new(ctx);
  let entry_obj = entry::new_entry(b"hero".to_string(), b"application/json".to_string(), mock_blob.to_inner(), false, @0xB);

  let _entry_id = publication::add_entry_to_collection(&mut publication_obj, &publisher_cap, collection_name, entry_obj, ctx);

  unit_test::destroy(mock_blob);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_add_entry_to_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection_obj = collection::new_collection(object::id(&publication_obj), collection_name, ctx);
  publication::add_collection(&mut publication_obj, &publisher_cap, collection_obj, ctx);

  let mock_blob = object::new(ctx);
  let entry_obj = entry::new_entry(b"First Post".to_string(), b"application/json".to_string(), mock_blob.to_inner(), false, ctx.sender());
  let entry_id = publication::add_entry_to_collection(&mut publication_obj, &publisher_cap, collection_name, entry_obj, ctx);

  assert_eq!(entry_id, 0);
  assert_eq!(publication::collection_entries_length(&publication_obj, collection_name), 1);

  unit_test::destroy(mock_blob);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_delete_entry_from_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection_obj = collection::new_collection(object::id(&publication_obj), collection_name, ctx);
  publication::add_collection(&mut publication_obj, &publisher_cap, collection_obj, ctx);

  let mock_blob = object::new(ctx);
  let entry_obj = entry::new_entry(b"First Post".to_string(), b"application/json".to_string(), mock_blob.to_inner(), false, ctx.sender());
  let entry_id = publication::add_entry_to_collection(&mut publication_obj, &publisher_cap, collection_name, entry_obj, ctx);

  publication::delete_entry_from_collection(&mut publication_obj, &publisher_cap, collection_name, entry_id, ctx);

  assert_eq!(publication::collection_entries_length(&publication_obj, collection_name), 0);

  unit_test::destroy(mock_blob);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_delete_then_add_entry_to_collection_uses_monotonic_entry_id() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection_obj = collection::new_collection(object::id(&publication_obj), collection_name, ctx);
  publication::add_collection(&mut publication_obj, &publisher_cap, collection_obj, ctx);

  let blob_0 = object::new(ctx);
  let blob_1 = object::new(ctx);
  let blob_2 = object::new(ctx);
  let blob_3 = object::new(ctx);

  let first_id = publication::add_entry_to_collection(
    &mut publication_obj,
    &publisher_cap,
    collection_name,
    entry::new_entry(b"a".to_string(), b"application/json".to_string(), blob_0.to_inner(), false, ctx.sender()),
    ctx,
  );
  let second_id = publication::add_entry_to_collection(
    &mut publication_obj,
    &publisher_cap,
    collection_name,
    entry::new_entry(b"b".to_string(), b"application/json".to_string(), blob_1.to_inner(), false, ctx.sender()),
    ctx,
  );
  let third_id = publication::add_entry_to_collection(
    &mut publication_obj,
    &publisher_cap,
    collection_name,
    entry::new_entry(b"c".to_string(), b"application/json".to_string(), blob_2.to_inner(), false, ctx.sender()),
    ctx,
  );

  publication::delete_entry_from_collection(&mut publication_obj, &publisher_cap, collection_name, second_id, ctx);

  let fourth_id = publication::add_entry_to_collection(
    &mut publication_obj,
    &publisher_cap,
    collection_name,
    entry::new_entry(b"d".to_string(), b"application/json".to_string(), blob_3.to_inner(), false, ctx.sender()),
    ctx,
  );

  assert_eq!(first_id, 0);
  assert_eq!(second_id, 1);
  assert_eq!(third_id, 2);
  assert_eq!(fourth_id, 3);
  assert_eq!(publication::collection_entries_length(&publication_obj, collection_name), 3);

  unit_test::destroy(blob_0);
  unit_test::destroy(blob_1);
  unit_test::destroy(blob_2);
  unit_test::destroy(blob_3);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun test_collection_entry_draft_and_publish_heads() {
  let ctx = &mut tx_context::dummy();
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication_for_testing(ctx, b"ArcSys Blog".to_string());

  let collection_name = b"articles".to_string();
  let collection_obj = collection::new_collection(object::id(&publication_obj), collection_name, ctx);
  publication::add_collection(&mut publication_obj, &publisher_cap, collection_obj, ctx);

  let blob_0 = object::new(ctx);
  let blob_1 = object::new(ctx);
  let blob_2 = object::new(ctx);

  let entry_id = publication::add_entry_to_collection(
    &mut publication_obj,
    &publisher_cap,
    collection_name,
    entry::new_entry(b"draft".to_string(), b"application/json".to_string(), blob_0.to_inner(), true, ctx.sender()),
    ctx,
  );

  let draft_rev = publication::append_collection_entry_draft_revision(
    &mut publication_obj,
    &publisher_cap,
    collection_name,
    entry_id,
    b"application/json".to_string(),
    blob_1.to_inner(),
    true,
    ctx,
  );

  let public_rev = publication::publish_collection_entry_from_draft(
    &mut publication_obj,
    &publisher_cap,
    collection_name,
    entry_id,
    draft_rev,
    b"application/json".to_string(),
    blob_2.to_inner(),
    ctx,
  );

  assert_eq!(publication::collection_entry_draft_head(&mut publication_obj, collection_name, entry_id), option::some(draft_rev));
  assert_eq!(publication::collection_entry_public_head(&mut publication_obj, collection_name, entry_id), option::some(public_rev));
  assert_eq!(publication::collection_entry_encrypted(&mut publication_obj, collection_name, entry_id), false);

  unit_test::destroy(blob_0);
  unit_test::destroy(blob_1);
  unit_test::destroy(blob_2);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}
