# Morse Contracts Design Notes (Pre-Implementation)

Status: Draft / In Progress

This document captures design decisions and open questions before implementation.

Important: unless explicitly marked as implemented, items in this file are NOT yet in on-chain code.

## Purpose

- Keep architecture decisions clear before writing Move code.
- Record tradeoffs for protocol-level choices (uniqueness, identity, mutability).
- Act as a living design doc for upcoming discussions.

## Current implementation snapshot

The current `publication` module already has:

- `collections` as `VecMap<String, Collection>`
- no separate singleton lane; all content is represented as collection entries
- collection entries keyed by monotonic `entry_id` (no key reuse after deletion)
- collection entry insertion returns assigned `entry_id` for indexing
- collection delete uses explicit `EEntryNotFound` abort semantics
- collection ownership invariant enforced in `add_collection` (`collection.publication_id` must match target publication)
- collection creation exposed via `publication::create_collection`; `collection::new_collection` is package-only
- owner-transfer flow via `transfer_owner_cap`
- publisher capability usage bound to a designated `holder` address (sender must match)
- owner-driven publisher-cap revocation via active-cap registry on `Publication`
- entry input validation in `new_entry` (non-empty fields, `name <= 256`, `content_type <= 255`)
- `content_type` lowercase MIME is advisory only (not enforced)
- entries use immutable revisions with `draft_head` and `public_head`
- each revision stores `{ blob, content_type, encrypted, author }`
- publication write paths enforce new-entry author matches transaction sender
- publications have immutable slugs
- publication creation is factory-gated through shared `PublicationRegistry` (`slug -> publication_id`)
- slugs are released on delete and reusable afterward

Reference: `morse-contracts/sources/publication.move`

## Proposed next design: publication slugs

We want each publication to have a user-provided slug (for example `my-personal-blog`) and guarantee global uniqueness inside the Morse package.

### Proposed requirements

- Add `slug` to `Publication` metadata.
- Ensure uniqueness at protocol level (not only in indexers/UI).
- Make publication creation go through a single registry/factory path.
- Keep this compatible with a decentralized, headless CMS model.

### Global uniqueness options considered

1. Classic registry mapping
- Shared registry object stores `slug -> publication_id` (for example via `Table<String, ID>`).
- Pros: supports slug edits and reuse policies.
- Cons: all slug writes pass through shared registry state.

2. Derived-object registry
- Use `derived_object::claim(&mut registry.id, slug)` to derive publication UID from slug.
- Pros: deterministic IDs, strong uniqueness, good parallelism after creation.
- Cons: generally best when slug is immutable (claimed keys are not naturally reclaimable).

### Decision (chosen)

- Slugs are immutable after publication creation.
- Use classic registry mapping for uniqueness (`slug -> publication_id`).
- Keep publication creation behind registry/factory entrypoints.
- Slugs are reusable after publication deletion.

Rationale:

- Immutable slugs keep protocol rules simpler and feel more web3-native.
- Classic registry mapping is straightforward to reason about and implement for this phase.

### Factory enforcement pattern

- Keep low-level publication constructor internal/private.
- Expose public creation only through `Registry` entrypoints that perform uniqueness checks.
- This enforces canonical Morse publications inside this package (while acknowledging other packages can exist).

### Implementation status

- Implemented: `Publication.slug` added and immutable after creation.
- Implemented: `PublicationRegistry` shared object stores active `slug -> publication_id` mappings.
- Implemented: public creation path is factory-gated through registry.
- Implemented: delete releases slug mapping so the slug can be reused.

Security note:

- Reusable slugs improve flexibility, but introduce squatting/impersonation risk for previously known slugs.
- Mitigation is currently social/off-chain (UI warnings and reputation checks); no on-chain grace/reservation period yet.

## Slug mutability tradeoff (for decentralized headless CMS)

### Immutable slug

- Pros: stable canonical identity, simpler rules, safer against rename abuse.
- Cons: poor rebrand/typo UX, harder recovery from bad initial slug.

### Editable slug

- Pros: better creator UX and CMS flexibility.
- Cons: more complex protocol rules, redirect/history requirements, stronger anti-spoof needs.

### Current direction

- Immutable canonical identity: publication object ID.
- Immutable human slug stored at creation time.
- No slug history/redirect mechanism planned in current phase.

## Capability model direction (owner/admin)

### Decision (chosen)

- `OwnerCap` should be transferable so publication ownership can be sold/transferred.
- `PublisherCap` should remain non-transferable through public APIs.
- Only `OwnerCap` holder can assign admins (publishers).

### Implications for implementation

- Implemented: explicit owner transfer flow via `transfer_owner_cap`.
- Implemented: publisher caps are owner-issued and bound to a `holder` address.
- Implemented: publisher-gated mutators enforce both `publication_id` match and sender/holder match.
- Implemented: owner can revoke publisher caps by ID; publisher writes require cap ID to be active.
- Implemented: revoked caps remain holder-destroyable so stale cap objects can be cleaned up.

Rationale:

- We do not want publishers to delegate/share write access with unapproved addresses.
- Owner remains the only authority that can assign admin access.

## Deployment / initialization pattern

### Decision (chosen)

- Do not use the one-time-witness (OTW) pattern in the current implementation phase.

### Why OTW is not required right now

- The core requirement is global slug uniqueness and canonical creation path, which is already addressed by a shared `PublicationRegistry` + registry/factory entrypoints.
- Access control is capability-based (`OwnerCap` / `PublisherCap`) and does not require OTW to enforce ownership/admin semantics.
- Adding OTW now would increase complexity without solving a current protocol gap.

### Future option

- OTW can be introduced later if we add type-level registration flows or stricter one-time initialization guarantees where witness-based proof materially improves safety.

Note: this is a design decision only; code has not been updated yet.

## Blob lifecycle / garbage collection

### Future work (not implemented yet)

- Entries currently store a Walrus blob reference by `ID` and do not own/wrap the blob object.
- Deleting an entry removes only the reference; it does not automatically delete the underlying blob.
- We need a future blob-GC strategy to prevent unreferenced (hanging) blobs.

### Candidate direction

- Add publication-level blob reference tracking (for example, ref counts by blob ID).
- Emit explicit events when blob references are added/removed and when a blob becomes unreferenced.
- Run owner-controlled or off-chain cleanup for unreferenced blobs.

Rationale:

- The contract only has blob IDs today, not blob ownership/capability handles, so direct in-contract deletion is not guaranteed to be possible/safe.

## Entry revision model (implemented)

Entries now use immutable revisions with separate draft/public heads.

### Core model

- `Entry` stores:
  - `revisions` (append-only sequence of `{ blob, content_type, encrypted }`)
  - `draft_head: Option<u64>`
  - `public_head: Option<u64>`
- `new_entry(name, content_type, blob, encrypted)` seeds revision `0` and initializes heads based on encryption mode.

### Invariants

- Revisions are append-only; existing revisions are not mutated in place.
- `public_head` is only moved by publish operations that append `encrypted = false` revisions.
- `draft_head` can diverge from `public_head` and continue moving after publish.
- Deleting an entry removes only on-chain references; blob lifecycle remains separate (see blob GC section above).

### Lifecycle supported

- Create encrypted draft revision.
- Append additional encrypted draft revisions while collaborating.
- Publish by appending a non-encrypted public revision.
- Continue drafting privately after publish.
- Re-publish from draft by appending another non-encrypted public revision.

### Surface-area impact

- Breaking API change: `entry::new_entry` now requires `encrypted`.
- Publication-level revision operations exist for collection entries.

## Collection publish design (planned, not implemented)

We will use a client-driven publish flow with optimistic concurrency checks.

### Decision (chosen)

- Draft updates are stored as normal (non-Quilt) entry revisions for fast, one-by-one UI edits.
- Collection publish to public/non-encrypted mode uses Quilt-backed storage pointers.
- No background/off-chain worker orchestration for this phase.
- No sharding for this phase.

### Proposed flow

1. Client reads current collection draft heads from chain.
2. Client computes deterministic `expected_heads_hash` from draft heads.
3. Client uploads publish payload blobs to Quilt.
4. Client calls one on-chain finalize-style function with:
   - `expected_heads_hash`
   - publish payload (entry mapping to Quilt pointers)

### Concurrency model

- Contract recomputes current heads hash and compares with `expected_heads_hash`.
- If drafts changed since client snapshot, publish aborts with conflict error.
- This prevents publishing stale snapshots without requiring `start_publish` / `publish_session_id`.

### Constraints and notes

- Publish is single-call for now (no shard/session protocol yet).
- Public revisions created by publish must be `encrypted = false`.
- Add payload size guardrails to keep publish txs practical.

Status: Not implemented yet.

## Planned (not implemented yet)

- [x] Add `slug` field to `Publication`.
- [x] Add shared `PublicationRegistry` object.
- [x] Route publication creation through registry/factory only.
- [x] Add slug validation rules (format, length, normalization expectations).
- [x] Add events for slug lifecycle (`SlugRegistered`).
- [x] Add tests for duplicate slug behavior and authorization.
- [ ] Add owner-cap transfer flow.
- [ ] Restrict publisher assignment to owner-only entrypoints.
- [ ] Add tests for owner transfer and post-transfer admin assignment permissions.
- [ ] Revisit OTW only if future requirements need one-time witness guarantees.

## Open questions

- Should slug normalization be enforced fully on-chain, or normalized off-chain + minimally validated on-chain?
- Should publication creation fail on mixed-case slug input, or auto-lowercase before storing?

## Notes for future updates

Add new design topics below this section as discussions continue. Keep each topic marked as either:

- Proposed (not implemented)
- Implemented (with file references)
