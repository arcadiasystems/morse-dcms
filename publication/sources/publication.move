/// Module: publication
module publication::publication;

use std::string::String;

public fun hello_world(): String {
  b"Hello, World!".to_string()
}

#[test_only]
use std::unit_test::assert_eq;

#[test]
fun test_hello_world() {
  assert_eq!(hello_world(), b"Hello, World!".to_string());
}
