# morse-contracts

Sui Move package for the Morse publication protocol.

This package defines the on-chain data model and write permissions for publications, collections, and named entries.

## Package

- Name: `publication`
- Move edition: `2024`
- Source modules: `sources/publication.move`, `sources/collection.move`, `sources/entry.move`

## Data model

The contract uses a three-level content model:

- `Publication` (shared object): root container for everything.
- `Collection` (object): named group of entries keyed by stable IDs.
- `Entry` (value): named entry with immutable blob revisions and separate draft/public heads.

Inside a publication:

- `slug`: immutable, user-provided URL slug.
- `collections`: `VecMap<String, Collection>` for a small number of named collections.
- `singletons`: `Table<String, Entry>` for one-off named entries and assets (for example, cover metadata or logo image).

Global slug registry:

- `PublicationRegistry` stores `slug -> publication_id` mappings.
- Publication creation is factory-gated through the registry.

Inside a collection:

- `entries`: `Table<u64, Entry>` keyed by monotonic `entry_id`.

Entry ID behavior:

- `entry_id` values are monotonic and are not re-used after deletions.
- Deleting an entry can leave gaps (for example, `0, 2, 3`).

Entry semantics:

- Revisions store raw Walrus blob object `ID` references (pointer model).
- Entries maintain `draft_head` and `public_head` revision pointers.
- Entry deletion removes only the on-chain reference; it does not automatically delete the blob.
- `content_type` is MIME metadata; lowercase values are recommended for consistency but not enforced.

Entry validation:

- `name` and `content_type` must be non-empty.
- `name` max length: `256`.
- `content_type` max length: `255`.

## Capability and authorization model

- `OwnerCap`: one per publication, required to issue/revoke publisher capabilities and delete a publication. Transferable by design so publication ownership can be transferred or sold.
- `PublisherCap`: many per publication, required for all write operations (collections, singletons, and collection entries). Usage is bound to the approved `holder` address.

Every mutating function validates that the cap's `publication_id` matches the target `Publication` ID and aborts with `EUnauthorized` when it does not.
Publisher-gated mutators also require `tx_context::sender(ctx) == cap.holder` and abort with `EPublisherCapWrongHolder` otherwise.
Publisher caps are also checked against `Publication.active_publisher_caps`; revoked/inactive caps abort with `EPublisherCapNotActive`.
Revocation disables write authority, but the holder can still destroy a revoked cap object for cleanup.

Why holder binding exists:

- The owner controls admin assignment and publishers should not be able to share write access with unapproved addresses by passing caps around.

## Public entrypoints

Core publication operations:

- `new_publication(registry, ctx, name, slug)`
- `delete_publication(registry, publication, owner_cap)`
- `issue_publisher_cap(publication, owner_cap, holder, ctx)`
- `revoke_publisher_cap(publication, owner_cap, cap_id)`
- `destroy_publisher_cap(publication, cap, ctx)`
- `transfer_owner_cap(owner_cap, recipient)`
- `contains_slug(registry, slug)`
- `get_publication_id_by_slug(registry, slug)`

Collection and entry operations:

- `create_collection(publication, cap, name, ctx)`
- `add_collection(publication, cap, collection, ctx)`
- `delete_collection(publication, cap, name, ctx)`
- `add_entry_to_collection(publication, cap, collection_name, entry, ctx)` -> `entry_id`
- `delete_entry_from_collection(publication, cap, collection_name, entry_id, ctx)`

Singleton operations:

- `add_singleton(publication, cap, entry, ctx)`
- `delete_singleton(publication, cap, name, ctx)`
- `append_singleton_draft_revision(publication, cap, name, content_type, blob, encrypted, ctx)` -> `revision_id`
- `publish_singleton_from_draft(publication, cap, name, draft_revision_id, content_type, blob, ctx)` -> `revision_id`
- `publish_singleton_direct(publication, cap, name, content_type, blob, ctx)` -> `revision_id`
- `get_singleton(publication, name)`
- `singletons_length(publication)`

Revision operations for collection entries:

- `append_collection_entry_draft_revision(publication, cap, collection_name, entry_id, content_type, blob, encrypted, ctx)` -> `revision_id`
- `publish_collection_entry_from_draft(publication, cap, collection_name, entry_id, draft_revision_id, content_type, blob, ctx)` -> `revision_id`
- `publish_collection_entry_direct(publication, cap, collection_name, entry_id, content_type, blob, ctx)` -> `revision_id`

Construction helpers:

- `entry::new_entry(name, content_type, blob, encrypted)`

## Abort codes

Defined in `publication::publication`:

- `ECollectionAlreadyExists = 0`
- `ESingletonAlreadyExists = 1`
- `EUnauthorized = 2`
- `ECollectionPublicationMismatch = 3`
- `EPublisherCapWrongHolder = 4`
- `EPublisherCapNotActive = 5`
- `ESlugAlreadyExists = 6`
- `ESlugEmpty = 7`
- `ESlugTooLong = 8`
- `ESlugInvalidChar = 9`
- `ESlugInvalidEdgeHyphen = 10`

Defined in `publication::collection`:

- `EEntryNotFound = 0`

Defined in `publication::entry`:

- `ENameEmpty = 0`
- `EContentTypeEmpty = 1`
- `ENameTooLong = 2`
- `EContentTypeTooLong = 3`
- `ERevisionNotFound = 4`

Invariants:

- `add_collection` requires the incoming collection's `publication_id` to match the target publication ID.
- Publisher write operations require the sender to be the cap's bound `holder`.
- Publisher write operations require the cap ID to be active in the publication's `active_publisher_caps` table.
- Collection creation is exposed via `publication::create_collection`; `collection::new_collection` is package-only.
- Slugs are unique while active in `PublicationRegistry` and immutable once publication is created.

Slug rules:

- Non-empty, max length `64`.
- Allowed characters: lowercase `a-z`, digits `0-9`, and `-`.
- Slugs cannot start or end with `-`.

Security note (slug reuse policy):

- Slugs are intentionally reusable after publication deletion.
- This increases flexibility, but introduces impersonation/squatting risk for previously known slugs.

Collection behavior:

- `add_entry_to_collection` returns a monotonic `entry_id` assigned at insert time.
- `delete_entry_from_collection` aborts with `collection::EEntryNotFound` for missing `entry_id`.

## Events

The publication module emits:

- `PublicationCreated`
- `PublicationDeleted`
- `PublisherCapIssued`
- `PublisherCapRevoked`
- `CollectionAdded`
- `CollectionRemoved`
- `SingletonAdded`
- `SingletonRemoved`

## Development commands

This package uses [Task](https://taskfile.dev) as a command runner.

```bash
task build           # sui move build
task test            # sui move test
task publish         # sui client publish (active env)
task upgrade         # sui client upgrade (active env)
task localnet        # start local Sui node + faucet (fresh genesis)
task faucet          # request local faucet SUI
task publish:local   # publish ephemerally to localnet
task clean           # remove Pub.local.toml
task switch:local    # switch sui client env to local
task switch:testnet  # switch sui client env to testnet
```

Run a single Move test:

```bash
sui move test <test_function_name>
```

## Localnet workflow

One-time setup:

```bash
sui client new-env --alias local --rpc http://127.0.0.1:9000
```

Typical local iteration:

```bash
task localnet      # terminal 1
task faucet        # terminal 2
task publish:local
task clean         # when localnet is regenerated
task switch:testnet
```

Note:

- `Move.toml` is kept targeting testnet for build/test compatibility.
- `publish:local` compiles with `--build-env testnet` and publishes to localnet.
- If localnet chain ID changes (`--force-regenesis`), regenerate local publish metadata with `task clean` then republish.

## Deployment metadata

- `Published.toml` is committed and tracks canonical published package IDs by environment.
- `Pub.*.toml` files are ephemeral publish outputs and should not be committed.
