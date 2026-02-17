module publication::content;

use std::string::String;

public struct Content has store, key {
  id: UID,
  content_type: String,
  blob_id: u256,
}

public fun new_content(content_type: String, blob_id: u256, ctx: &mut TxContext): Content {
  let content = Content {
    id: object::new(ctx),
    content_type,
    blob_id,
  };
  content
}

public fun get_address(content: &Content): address {
  content.id.to_address()
}

#[test_only]
use std::unit_test;

#[test_only]
use std::unit_test::assert_eq;

#[test]
fun test_new_content() {
  let ctx = &mut tx_context::dummy();

  let content_type = b"article".to_string();
  let blob_id = 1234;
  let content = new_content(content_type, blob_id, ctx);

  assert_eq!(content.content_type, content_type);

  unit_test::destroy(content);
}
