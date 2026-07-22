module publication::publication_tests;

use std::unit_test;
use std::unit_test::assert_eq;

use publication::entry;
use publication::publication;

// -- helpers --

#[test_only]
fun setup(ctx: &mut TxContext): (publication::PublicationRegistry, publication::Publication, publication::OwnerCap, publication::PublisherCap) {
  let mut registry = publication::new_registry_for_testing(ctx);
  let (pub_obj, owner_cap, publisher_cap) = publication::new_publication(
    &mut registry, b"ArcSys Blog".to_string(), b"arcsys-blog".to_string(), ctx,
  );
  (registry, pub_obj, owner_cap, publisher_cap)
}

/// 37-byte fake QuiltPatchId for testing.
#[test_only]
fun fake_patch_id(): vector<u8> {
  vector[
    1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
    17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,
    0, 0,1, 0,4,
  ]
}

// -- Publication tests --

#[test]
fun new_publication() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);
  let publication_name = b"ArcSys Blog".to_string();

  let (publication_obj, owner_cap, publisher_cap) = publication::new_publication(
    &mut registry, publication_name, b"arcsys-blog".to_string(), ctx,
  );

  assert_eq!(publication::collections_length(&publication_obj), 0);
  assert_eq!(publication::is_publisher_cap_revoked(&publication_obj, object::id(&publisher_cap)), false);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun slug_registry_lookup() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);
  let (publication_obj, owner_cap, publisher_cap) = publication::new_publication(
    &mut registry, b"ArcSys Blog".to_string(), b"my-personal-blog".to_string(), ctx,
  );

  assert_eq!(publication::contains_slug(&registry, b"my-personal-blog".to_string()), true);
  assert_eq!(
    *publication::publication_id_by_slug(&registry, b"my-personal-blog".to_string()),
    object::id(&publication_obj),
  );

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = publication::ESlugAlreadyExists)]
fun duplicate_slug_fails() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);

  let (publication_obj, owner_cap, publisher_cap) = publication::new_publication(
    &mut registry, b"ArcSys Blog".to_string(), b"my-personal-blog".to_string(), ctx,
  );
  let (_other_publication, _other_owner_cap, _other_publisher_cap) = publication::new_publication(
    &mut registry, b"Other".to_string(), b"my-personal-blog".to_string(), ctx,
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
fun invalid_slug_fails() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);
  let (publication_obj, owner_cap, publisher_cap) = publication::new_publication(
    &mut registry, b"ArcSys Blog".to_string(), b"My-Personal-Blog".to_string(), ctx,
  );
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(registry);
}

#[test]
fun slug_reusable_after_delete() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);

  let (publication_obj, owner_cap, publisher_cap) = publication::new_publication(
    &mut registry, b"ArcSys Blog".to_string(), b"my-personal-blog".to_string(), ctx,
  );

  publication::delete_publication(&mut registry, publication_obj, owner_cap);
  assert_eq!(publication::contains_slug(&registry, b"my-personal-blog".to_string()), false);

  let (publication_obj_2, owner_cap_2, publisher_cap_2) = publication::new_publication(
    &mut registry, b"ArcSys Blog v2".to_string(), b"my-personal-blog".to_string(), ctx,
  );
  assert_eq!(publication::contains_slug(&registry, b"my-personal-blog".to_string()), true);

  unit_test::destroy(registry);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(publication_obj_2);
  unit_test::destroy(owner_cap_2);
  unit_test::destroy(publisher_cap_2);
}

#[test]
fun delete_publication() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);
  let (publication_obj, owner_cap, publisher_cap) = publication::new_publication(
    &mut registry, b"ArcSys Blog".to_string(), b"delete-me".to_string(), ctx,
  );

  publication::delete_publication(&mut registry, publication_obj, owner_cap);

  unit_test::destroy(registry);
  unit_test::destroy(publisher_cap);
}

#[test]
fun delete_publication_with_revoked_cap_succeeds() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication(
    &mut registry, b"ArcSys Blog".to_string(), b"delete-me-2".to_string(), ctx,
  );

  let cap_id = object::id(&publisher_cap);
  publication::revoke_publisher_cap(&mut publication_obj, &owner_cap, cap_id);
  publication::delete_publication(&mut registry, publication_obj, owner_cap);

  unit_test::destroy(registry);
  unit_test::destroy(publisher_cap);
}

// -- Authorization tests --

#[test]
fun issue_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  let new_cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  assert_eq!(publication::is_publisher_cap_revoked(&publication_obj, object::id(&new_cap)), false);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(new_cap);
}

#[test]
fun destroy_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  publication::destroy_publisher_cap(&mut publication_obj, publisher_cap, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
}

#[test, expected_failure(abort_code = publication::EPublisherCapWrongHolder)]
fun wrong_holder_cannot_use_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);
  let other_holder = @0xB;
  let other_cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, other_holder, ctx);

  publication::create_collection(&mut publication_obj, &other_cap, b"articles".to_string(), 0, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_cap);
}

#[test, expected_failure(abort_code = publication::EPublisherCapWrongHolder)]
fun wrong_holder_cannot_destroy_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);
  let other_cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, @0xB, ctx);

  publication::destroy_publisher_cap(&mut publication_obj, other_cap, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun owner_can_revoke_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);
  let cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  publication::revoke_publisher_cap(&mut publication_obj, &owner_cap, cap_id);
  assert_eq!(publication::is_publisher_cap_revoked(&publication_obj, cap_id), true);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = publication::EPublisherCapRevoked)]
fun revoked_cap_cannot_write() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);
  let cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  publication::revoke_publisher_cap(&mut publication_obj, &owner_cap, cap_id);
  publication::create_collection(&mut publication_obj, &cap, b"articles".to_string(), 0, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = publication::EUnauthorized)]
fun wrong_owner_cannot_revoke_publisher_cap() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication(
    &mut registry, b"ArcSys Blog".to_string(), b"pub-a".to_string(), ctx,
  );
  let (other_publication, other_owner_cap, other_publisher_cap) = publication::new_publication(
    &mut registry, b"Other".to_string(), b"pub-b".to_string(), ctx,
  );
  let cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  publication::revoke_publisher_cap(&mut publication_obj, &other_owner_cap, cap_id);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_publication);
  unit_test::destroy(other_owner_cap);
  unit_test::destroy(other_publisher_cap);
  unit_test::destroy(cap);
}

#[test, expected_failure(abort_code = publication::EPublisherCapRevoked)]
fun double_revoke_fails() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);
  let cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  publication::revoke_publisher_cap(&mut publication_obj, &owner_cap, cap_id);
  publication::revoke_publisher_cap(&mut publication_obj, &owner_cap, cap_id);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(cap);
}

#[test]
fun destroy_revoked_cap_succeeds() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);
  let cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);

  publication::revoke_publisher_cap(&mut publication_obj, &owner_cap, cap_id);
  publication::destroy_publisher_cap(&mut publication_obj, cap, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

// -- Collection tests --

#[test]
fun add_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  let collection_name = b"articles".to_string();
  publication::create_collection(&mut publication_obj, &publisher_cap, collection_name, 0, ctx);

  assert_eq!(publication::collections_length(&publication_obj), 1);
  assert_eq!(publication::contains_collection(&publication_obj, collection_name), true);
  assert_eq!(publication::collection_storage_mode(&publication_obj, collection_name), 0);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun create_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  publication::create_collection(&mut publication_obj, &publisher_cap, b"articles".to_string(), 0, ctx);

  assert_eq!(publication::collections_length(&publication_obj), 1);
  assert_eq!(publication::contains_collection(&publication_obj, b"articles".to_string()), true);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun create_quilt_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  publication::create_collection(&mut publication_obj, &publisher_cap, b"pages".to_string(), 1, ctx);

  assert_eq!(publication::collections_length(&publication_obj), 1);
  assert_eq!(publication::contains_collection(&publication_obj, b"pages".to_string()), true);
  assert_eq!(publication::collection_storage_mode(&publication_obj, b"pages".to_string()), 1);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = publication::ECollectionAlreadyExists)]
fun create_duplicate_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  publication::create_collection(&mut publication_obj, &publisher_cap, b"articles".to_string(), 0, ctx);
  publication::create_collection(&mut publication_obj, &publisher_cap, b"articles".to_string(), 0, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun delete_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  let collection_name = b"articles".to_string();
  publication::create_collection(&mut publication_obj, &publisher_cap, collection_name, 0, ctx);
  assert_eq!(publication::collections_length(&publication_obj), 1);

  publication::delete_collection(&mut publication_obj, &publisher_cap, collection_name, ctx);
  assert_eq!(publication::collections_length(&publication_obj), 0);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun publisher_can_create_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, root_publisher_cap) = setup(ctx);

  let publisher_cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  publication::create_collection(&mut publication_obj, &publisher_cap, b"articles".to_string(), 0, ctx);

  assert_eq!(publication::collections_length(&publication_obj), 1);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(root_publisher_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = publication::EUnauthorized)]
fun unauthorized_create_collection() {
  let ctx = &mut tx_context::dummy();
  let mut registry = publication::new_registry_for_testing(ctx);
  let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication(
    &mut registry, b"ArcSys Blog".to_string(), b"pub-a".to_string(), ctx,
  );
  let (other_pub, other_owner_cap, other_publisher_cap) = publication::new_publication(
    &mut registry, b"Other".to_string(), b"pub-b".to_string(), ctx,
  );

  publication::create_collection(&mut publication_obj, &other_publisher_cap, b"articles".to_string(), 0, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(other_pub);
  unit_test::destroy(other_owner_cap);
  unit_test::destroy(other_publisher_cap);
}

// -- Entry tests --

#[test]
fun add_entry_to_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  let collection_name = b"articles".to_string();
  publication::create_collection(&mut publication_obj, &publisher_cap, collection_name, 0, ctx);

  let mock_blob = object::new(ctx);
  let entry_id = publication::add_entry_to_collection_for_testing(
    &mut publication_obj, &publisher_cap, collection_name,
    b"First Post".to_string(), mock_blob.to_inner(), option::none(),
    b"application/json".to_string(), false, entry::access_policy_public(), option::none(),
    ctx,
  );

  assert_eq!(entry_id, 0);
  assert_eq!(publication::collection_entries_length(&publication_obj, collection_name), 1);

  mock_blob.delete();
  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun delete_entry_from_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  let collection_name = b"articles".to_string();
  publication::create_collection(&mut publication_obj, &publisher_cap, collection_name, 0, ctx);

  let mock_blob = object::new(ctx);
  let entry_id = publication::add_entry_to_collection_for_testing(
    &mut publication_obj, &publisher_cap, collection_name,
    b"First Post".to_string(), mock_blob.to_inner(), option::none(),
    b"application/json".to_string(), false, entry::access_policy_public(), option::none(),
    ctx,
  );

  publication::delete_entry_from_collection(&mut publication_obj, &publisher_cap, collection_name, entry_id, ctx);
  assert_eq!(publication::collection_entries_length(&publication_obj, collection_name), 0);

  mock_blob.delete();
  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun delete_then_add_entry_to_collection_uses_monotonic_entry_id() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  let collection_name = b"articles".to_string();
  publication::create_collection(&mut publication_obj, &publisher_cap, collection_name, 0, ctx);

  let blob_0 = object::new(ctx);
  let blob_1 = object::new(ctx);
  let blob_2 = object::new(ctx);
  let blob_3 = object::new(ctx);

  let first_id = publication::add_entry_to_collection_for_testing(
    &mut publication_obj, &publisher_cap, collection_name,
    b"a".to_string(), blob_0.to_inner(), option::none(),
    b"application/json".to_string(), false, entry::access_policy_public(), option::none(), ctx,
  );
  let second_id = publication::add_entry_to_collection_for_testing(
    &mut publication_obj, &publisher_cap, collection_name,
    b"b".to_string(), blob_1.to_inner(), option::none(),
    b"application/json".to_string(), false, entry::access_policy_public(), option::none(), ctx,
  );
  let third_id = publication::add_entry_to_collection_for_testing(
    &mut publication_obj, &publisher_cap, collection_name,
    b"c".to_string(), blob_2.to_inner(), option::none(),
    b"application/json".to_string(), false, entry::access_policy_public(), option::none(), ctx,
  );

  publication::delete_entry_from_collection(&mut publication_obj, &publisher_cap, collection_name, second_id, ctx);

  let fourth_id = publication::add_entry_to_collection_for_testing(
    &mut publication_obj, &publisher_cap, collection_name,
    b"d".to_string(), blob_3.to_inner(), option::none(),
    b"application/json".to_string(), false, entry::access_policy_public(), option::none(), ctx,
  );

  assert_eq!(first_id, 0);
  assert_eq!(second_id, 1);
  assert_eq!(third_id, 2);
  assert_eq!(fourth_id, 3);
  assert_eq!(publication::collection_entries_length(&publication_obj, collection_name), 3);

  blob_0.delete();
  blob_1.delete();
  blob_2.delete();
  blob_3.delete();
  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun collection_entry_draft_and_publish_heads() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  let collection_name = b"articles".to_string();
  publication::create_collection(&mut publication_obj, &publisher_cap, collection_name, 0, ctx);

  let blob_0 = object::new(ctx);
  let blob_1 = object::new(ctx);
  let blob_2 = object::new(ctx);

  let entry_id = publication::add_entry_to_collection_for_testing(
    &mut publication_obj, &publisher_cap, collection_name,
    b"draft".to_string(), blob_0.to_inner(), option::none(),
    b"application/json".to_string(), true, entry::access_policy_publisher(), option::some(b"draft-seal-0"),
    ctx,
  );

  let draft_rev = publication::append_collection_entry_draft_revision_for_testing(
    &mut publication_obj, &publisher_cap, collection_name, entry_id,
    blob_1.to_inner(), option::none(),
    b"application/json".to_string(), true, entry::access_policy_publisher(), option::some(b"draft-seal-1"),
    ctx,
  );

  let public_rev = publication::publish_collection_entry_from_draft_for_testing(
    &mut publication_obj, &publisher_cap, collection_name, entry_id,
    draft_rev, blob_2.to_inner(), option::none(),
    b"application/json".to_string(), ctx,
  );

  assert_eq!(publication::collection_entry_draft_head(&mut publication_obj, collection_name, entry_id), option::some(draft_rev));
  assert_eq!(publication::collection_entry_public_head(&mut publication_obj, collection_name, entry_id), option::some(public_rev));
  assert_eq!(publication::collection_entry_encrypted(&mut publication_obj, collection_name, entry_id), false);
  assert_eq!(publication::collection_entry_access_policy(&mut publication_obj, collection_name, entry_id), entry::access_policy_public());
  assert_eq!(publication::collection_entry_has_seal_id(&mut publication_obj, collection_name, entry_id), false);

  blob_0.delete();
  blob_1.delete();
  blob_2.delete();
  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test]
fun add_quilt_entry_to_collection() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  let collection_name = b"pages".to_string();
  publication::create_collection(&mut publication_obj, &publisher_cap, collection_name, 1, ctx);

  let quilt_blob = object::new(ctx);
  let entry_id = publication::add_entry_to_collection_for_testing(
    &mut publication_obj, &publisher_cap, collection_name,
    b"home".to_string(), quilt_blob.to_inner(), option::some(fake_patch_id()),
    b"application/json".to_string(), false, entry::access_policy_public(), option::none(),
    ctx,
  );

  assert_eq!(entry_id, 0);
  assert_eq!(publication::collection_entries_length(&publication_obj, collection_name), 1);

  quilt_blob.delete();
  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = entry::EQuiltPatchIdRequired)]
fun add_entry_to_quilt_collection_without_patch_id_fails() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  let collection_name = b"pages".to_string();
  publication::create_collection(&mut publication_obj, &publisher_cap, collection_name, 1, ctx);

  let quilt_blob = object::new(ctx);
  let _entry_id = publication::add_entry_to_collection_for_testing(
    &mut publication_obj, &publisher_cap, collection_name,
    b"home".to_string(), quilt_blob.to_inner(), option::none(), // missing patch ID
    b"application/json".to_string(), false, entry::access_policy_public(), option::none(),
    ctx,
  );

  quilt_blob.delete();
  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = entry::EQuiltPatchIdNotAllowed)]
fun add_entry_to_blob_collection_with_patch_id_fails() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);

  let collection_name = b"articles".to_string();
  publication::create_collection(&mut publication_obj, &publisher_cap, collection_name, 0, ctx);

  let blob = object::new(ctx);
  let _entry_id = publication::add_entry_to_collection_for_testing(
    &mut publication_obj, &publisher_cap, collection_name,
    b"post".to_string(), blob.to_inner(), option::some(fake_patch_id()), // patch ID not allowed
    b"application/json".to_string(), false, entry::access_policy_public(), option::none(),
    ctx,
  );

  blob.delete();
  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

// -- Seal tests --

#[test]
fun seal_approve_publisher_succeeds_for_active_holder() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, publication_obj, owner_cap, publisher_cap) = setup(ctx);
  let id = publication::publisher_seal_id_for_testing(&publication_obj, b"nonce");

  publication::seal_approve_publisher_for_testing(id, &publication_obj, &publisher_cap, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = publication::ESealInvalidId)]
fun seal_approve_publisher_rejects_invalid_id_prefix() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, publication_obj, owner_cap, publisher_cap) = setup(ctx);

  publication::seal_approve_publisher_for_testing(b"bad", &publication_obj, &publisher_cap, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = publication::ESealWrongPolicyTag)]
fun seal_approve_publisher_rejects_wrong_policy_tag() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, publication_obj, owner_cap, publisher_cap) = setup(ctx);
  let mut id = object::id(&publication_obj).to_bytes();
  vector::push_back(&mut id, 2);
  vector::push_back(&mut id, 9);

  publication::seal_approve_publisher_for_testing(id, &publication_obj, &publisher_cap, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
}

#[test, expected_failure(abort_code = publication::EPublisherCapWrongHolder)]
fun seal_approve_publisher_rejects_wrong_holder() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, root_publisher_cap) = setup(ctx);
  let holder_cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, @0xB, ctx);
  let id = publication::publisher_seal_id_for_testing(&publication_obj, b"nonce");

  publication::seal_approve_publisher_for_testing(id, &publication_obj, &holder_cap, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(root_publisher_cap);
  unit_test::destroy(holder_cap);
}

#[test, expected_failure(abort_code = publication::EPublisherCapRevoked)]
fun seal_approve_publisher_rejects_revoked_cap() {
  let ctx = &mut tx_context::dummy();
  let (mut registry, mut publication_obj, owner_cap, publisher_cap) = setup(ctx);
  let cap = publication::issue_publisher_cap(&mut publication_obj, &owner_cap, ctx.sender(), ctx);
  let cap_id = object::id(&cap);
  let id = publication::publisher_seal_id_for_testing(&publication_obj, b"nonce");

  publication::revoke_publisher_cap(&mut publication_obj, &owner_cap, cap_id);
  publication::seal_approve_publisher_for_testing(id, &publication_obj, &cap, ctx);

  unit_test::destroy(registry);
  unit_test::destroy(publication_obj);
  unit_test::destroy(owner_cap);
  unit_test::destroy(publisher_cap);
  unit_test::destroy(cap);
}
