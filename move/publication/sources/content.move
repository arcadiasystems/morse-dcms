module publication::content;

use std::string::String;

public struct Content has store, drop {
  name: String,
  content_type: String,
  blob_id: u256,
}

public fun new_content(name: String, content_type: String, blob_id: u256): Content {
  let content = Content {
    name,
    content_type,
    blob_id,
  };
  content
}


#[test_only]
use std::unit_test;

#[test_only]
use std::unit_test::assert_eq;

#[test]
fun test_new_content() {
  let name = b"First Blog Post".to_string();
  let content_type = b"application/json".to_string();
  let blob_id = 1234;
  let content = new_content(
    name,
    content_type,
    blob_id,
  );

  assert_eq!(content.content_type, content_type);

  unit_test::destroy(content);
}
