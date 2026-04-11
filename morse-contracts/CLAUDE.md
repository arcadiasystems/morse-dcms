# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Uses [Task](https://taskfile.dev) as a task runner (`task <name>`):

| Command | Description |
|---|---|
| Command | Description |
|---|---|
| `task build` | `sui move build` |
| `task test` | `sui move test` |
| `task publish` | `sui client publish` (targets active env) |
| `task upgrade` | `sui client upgrade` (targets active env) |
| `task localnet` | Start local Sui node with faucet (fresh genesis) |
| `task faucet` | Request SUI from local faucet |
| `task publish:local` | Publish ephemerally to localnet; does not update `Published.toml` |
| `task switch:local` | Switch active environment to localnet |
| `task switch:testnet` | Switch active environment to testnet |
| `task update-sui` | `suiup update sui` |
| `task update-suiup` | `suiup self update` |

To run a single test: `sui move test <test_function_name>`

### Localnet workflow

One-time setup (once per machine):
```sh
sui client new-env --alias local --rpc http://127.0.0.1:9000
```

Then to develop locally: 
```sh
task localnet        # terminal 1 — keep running
task faucet          # terminal 2 — wait ~60s for coins to arrive
task publish:local   # publishes to localnet (switches env to local internally)
task clean           # delete the ephemeral Pub.local.toml
task switch:testnet  # switch back to testnet
```

> **Why switch back?** Sui requires the chain ID to be hardcoded in `Move.toml` to run `build` or `test` against a specific network. To avoid that, we keep `Move.toml` targeting testnet and only switch to localnet for the `publish:local` step. `task publish:local` handles the env switch internally.

> **Stale `Pub.local.toml`?** Each fresh localnet (`--force-regenesis`) gets a new chain ID, making any existing `Pub.local.toml` invalid. If `publish:local` fails with a chain-id mismatch error, run `task clean` first and retry.

## Architecture

This is a **Sui Move** smart contract package (`edition = "2024"`) targeting the Sui blockchain. The package name is `publication`.

### Object model

Three modules form a clear hierarchy:

- **`publication::publication`** — Top-level shared object (`Publication`: `key` only — no `store`). Holds immutable `slug` and named collections (`VecMap<String, Collection>`). Creation is factory-gated through shared `PublicationRegistry` (`slug -> publication_id`). All mutations require an `OwnerCap` or `PublisherCap` tied to the publication's ID.
- **`publication::collection`** — Mid-level grouping (`Collection`: `key, store`). Wrapped inside `Publication`; holds entries in a `Table<u64, Entry>`, keyed by monotonic `entry_id` values returned on insert. Each collection has immutable `storage_mode` (`0 = blob`, `1 = quilt`) selected at creation. `collection::new_collection` is package-only; external creation flow goes through `publication::create_collection(publication, cap, name, storage_mode, ctx)`. `VecMap` is used for top-level collections because publications are expected to have few of them; `Table` is used for collection entries because they can be numerous.
- **`publication::entry`** — Leaf value (`Entry`: `store, drop`) with immutable revisions. Each revision stores a `blob_ref: BlobRef` (`Blob(ID)` for normal blobs, `QuiltPatch(vector<u8>)` for 37-byte QuiltPatchId), plus `content_type`, `encrypted`, and `author`. Entries track `draft_head` and `public_head`. `new_entry` enforces non-empty fields with max lengths (`name <= 256`, `content_type <= 255`); lowercase MIME casing is recommended but not enforced. Publication write APIs bind author provenance to `tx_context::sender(ctx)` on insert/append/publish flows.

### Capability model

- **`OwnerCap`** (`key` only) — one per publication. Required to issue `PublisherCap`s and delete the publication. Transferable by design to support publication ownership transfer.
- **`PublisherCap`** (`key` only) — multiple per publication. Required for all write operations (add/delete collections and collection entries). Issued by the owner via `issue_publisher_cap` and bound to a `holder` address.

Publisher-gated mutators additionally verify `tx_context::sender(ctx) == cap.holder` so a moved/shared cap object cannot be used by unapproved addresses.

**Revocation model — denylist, not allowlist:** `Publication` stores `revoked_publisher_caps: Table<ID, bool>`, a denylist of revoked cap IDs. Issuing a cap has zero table writes; only revocations write to the table. This is optimal because revocation is an edge case (misbehaving publisher), not normal operation. The denylist approach is safe because `PublisherCap` has no `store` ability and no external constructor — caps cannot be fabricated outside this module.

- `revoke_publisher_cap` inserts the cap ID into the denylist; double-revoke aborts with `EPublisherCapRevoked`.
- Write operations assert `!revoked_publisher_caps.contains(cap_id)`.
- `destroy_publisher_cap` removes the entry from the denylist if present (storage cleanup), but is not required before publication deletion.
- `delete_publication` calls `revoked_publisher_caps.drop()` — the table is dropped unconditionally regardless of remaining entries (safe because `bool` has `drop`).

Slug policy: slugs are immutable per publication and unique while active in the registry. Slugs are released on publication delete and are reusable afterward (tradeoff: flexibility vs potential squatting/impersonation risk).

### Events

`publication` emits events for: `PublicationCreated`, `PublicationDeleted`, `PublisherCapIssued`, `PublisherCapRevoked`, `CollectionAdded`, `CollectionRemoved`.

### Deployment metadata

- `Published.toml` — committed; tracks published package addresses per environment (testnet, etc.)
- `Pub.*.toml` — gitignored; ephemeral per-publish metadata generated by the Move toolchain

## Move Best Practices

### Pure creation functions

Creation functions must be **pure**: they return objects and never call `transfer::*` internally.
The caller (PTB or test) decides what to do with the returned objects.

```move
// CORRECT: pure — returns objects, no side effects
public fun new_publication(...): (Publication, OwnerCap, PublisherCap) { ... }

// WRONG: impure — hides transfer side effects inside the constructor
public fun new_publication(...) {
  ...
  transfer::share_object(publication);   // ❌
  transfer::transfer(owner_cap, sender); // ❌
}
```

Provide a dedicated `share_*` function for objects that must be shared, so callers can compose it in their PTB:

```move
public fun share_publication(publication: Publication) {
  transfer::share_object(publication)
}
```

Reference: https://docs.sui.io/guides/developer/move-best-practices#pure-functions

### Test helpers: only mock what cannot be tested through the public API

Use `#[test_only]` helpers **only** for things that are genuinely impossible to reach via the public API in tests:

- **Allowed:** Constructors for singleton objects created by `init()` (e.g. `new_registry_for_testing`) — `init` cannot be called directly in unit tests.
- **Allowed:** Thin wrappers around `entry fun` functions (e.g. `seal_approve_publisher_for_testing`) — `entry` functions cannot be called from other Move modules.
- **Allowed:** Read accessors for private struct fields (e.g. `collections_length`, `is_publisher_cap_revoked`) — struct fields are private.
- **Allowed:** Bypasses for third-party objects with no test constructor (e.g. `new_entry_for_testing` accepting `blob_id: ID` instead of `blob: &walrus::blob::Blob`) — `walrus::blob::Blob` cannot be constructed in Move unit tests because `blob::new` is `public(package)` and Walrus provides no `#[test_only]` blob constructor. The bypass skips only the third-party validation, not your own logic.
- **Not allowed:** Alternative constructors that bypass or duplicate production creation logic (e.g. `new_publication_for_testing` that skips the registry). Tests must call the real function.

The rule: **if a test only exercises `#[test_only]` code, it is testing the mock, not the implementation.**

### Test setup pattern

Every test that needs a `Publication` follows this pattern — no test-only creation shortcuts:

```move
let ctx = &mut tx_context::dummy();
let mut registry = publication::new_registry_for_testing(ctx); // init() bypass — legitimate
let (mut publication_obj, owner_cap, publisher_cap) = publication::new_publication(
  &mut registry, ctx, b"My Publication".to_string(), b"my-slug".to_string(),
);
```

When a test creates two publications, use distinct slugs (e.g. `"pub-a"` and `"pub-b"`) since the registry enforces uniqueness.

### Module organization: by component, not by kind

Organize module source files by **logical component** (the feature/concept they belong to), not by technical kind (all structs together, all constants together, etc.).

Each component section groups its related items together in this order:
1. Error constants
2. Structs
3. Public functions
4. Events
5. `#[test_only]` helpers
6. Internal (`// internal`) functions

Delimit sections with a `// -- Component Name --` comment (plain `//`, not a doc comment `///`).

Mark internal helper functions with a `// internal` line comment immediately above the `fun` keyword. These are package-private helpers that support the public API in that section but are not part of the external interface.

**Example structure** (from `publication.move`):
```
// -- Collections --

const ECollectionAlreadyExists: u64 = 0;

public struct CollectionAdded has copy, drop { ... }

public fun create_collection(...) { ... }
public fun delete_collection(...) { ... }

public struct CollectionAdded has copy, drop { ... }
public struct CollectionRemoved has copy, drop { ... }

#[test_only]
public(package) fun collections_length(...): u64 { ... }

// internal
fun get_collection_entry_for_write(...): &mut Entry { ... }
```

**Rationale:** grouping by component keeps all the context for a feature in one place (error codes, types, functions, events), making it easier to read, review, and extend without scrolling across the file.
