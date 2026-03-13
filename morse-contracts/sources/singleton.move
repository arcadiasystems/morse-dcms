module publication::singleton;

use std::string::String;
use sui::event;

/// A singleton belonging to a publication.
/// Holds a reference to a single Walrus Blob object by its on-chain ID.
/// The blob is not wrapped — it remains an independent object and can be renewed
/// or replaced without touching the singleton.
public struct Singleton has key, store {
  id: UID,
  publication_id: ID,
  name: String,
  blob: ID,
}

/// Create a new singleton with a reference to an existing Walrus Blob object.
public fun new_singleton(publication_id: ID, name: String, blob: ID, ctx: &mut TxContext): Singleton {
  let singleton = Singleton {
    id: object::new(ctx),
    publication_id,
    name,
    blob,
  };

  event::emit(SingletonCreated {
    singleton: object::id(&singleton),
    publication: publication_id,
    name,
  });

  singleton
}

/// Delete a singleton.
public fun delete_singleton(singleton: Singleton) {
  let Singleton { id, publication_id: _, name, blob: _ } = singleton;
  let singleton_id = id.to_inner();

  id.delete();

  event::emit(SingletonDeleted {
    singleton: singleton_id,
    name,
  });
}

public fun get_name(singleton: &Singleton): String {
  singleton.name
}

public fun get_blob(singleton: &Singleton): ID {
  singleton.blob
}

/// Update the Walrus Blob object reference.
public fun set_blob(singleton: &mut Singleton, blob: ID) {
  singleton.blob = blob;

  event::emit(SingletonUpdated {
    singleton: object::id(singleton),
    blob,
  });
}

/// Event emitted when a new singleton is created.
public struct SingletonCreated has copy, drop {
  singleton: ID,
  publication: ID,
  name: String,
}

/// Event emitted when a singleton is deleted.
public struct SingletonDeleted has copy, drop {
  singleton: ID,
  name: String,
}

/// Event emitted when the blob reference of a singleton is updated.
public struct SingletonUpdated has copy, drop {
  singleton: ID,
  blob: ID,
}

#[test_only]
use std::unit_test;

#[test_only]
use std::unit_test::assert_eq;

#[test]
fun test_new_singleton() {
  let ctx = &mut tx_context::dummy();

  let mock_publication_id = object::new(ctx);
  let mock_blob_id = object::new(ctx);

  let singleton = new_singleton(
    mock_publication_id.to_inner(),
    b"cover".to_string(),
    mock_blob_id.to_inner(),
    ctx,
  );

  assert_eq!(singleton.publication_id, mock_publication_id.to_inner());
  assert_eq!(singleton.name, b"cover".to_string());
  assert_eq!(singleton.blob, mock_blob_id.to_inner());

  unit_test::destroy(mock_publication_id);
  unit_test::destroy(mock_blob_id);
  unit_test::destroy(singleton);
}

#[test]
fun test_set_blob() {
  let ctx = &mut tx_context::dummy();

  let mock_publication_id = object::new(ctx);
  let mock_blob_id = object::new(ctx);
  let mock_new_blob_id = object::new(ctx);

  let mut singleton = new_singleton(
    mock_publication_id.to_inner(),
    b"cover".to_string(),
    mock_blob_id.to_inner(),
    ctx,
  );

  singleton.set_blob(mock_new_blob_id.to_inner());

  assert_eq!(singleton.blob, mock_new_blob_id.to_inner());

  unit_test::destroy(mock_publication_id);
  unit_test::destroy(mock_blob_id);
  unit_test::destroy(mock_new_blob_id);
  unit_test::destroy(singleton);
}

#[test]
fun test_delete_singleton() {
  let ctx = &mut tx_context::dummy();

  let mock_publication_id = object::new(ctx);
  let mock_blob_id = object::new(ctx);

  let singleton = new_singleton(
    mock_publication_id.to_inner(),
    b"cover".to_string(),
    mock_blob_id.to_inner(),
    ctx,
  );

  singleton.delete_singleton();

  unit_test::destroy(mock_publication_id);
  unit_test::destroy(mock_blob_id);
}
