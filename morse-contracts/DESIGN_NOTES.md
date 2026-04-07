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
- root `singletons` as `Table<String, Entry>`
- no separate `assets` bucket (assets are represented as named singletons)
- collection entries keyed by monotonic `entry_id` (no key reuse after deletion)
- collection ownership invariant enforced in `add_collection` (`collection.publication_id` must match target publication)
- owner-transfer flow via `transfer_owner_cap`
- publisher capability usage bound to a designated `holder` address (sender must match)

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

Rationale:

- Immutable slugs keep protocol rules simpler and feel more web3-native.
- Classic registry mapping is straightforward to reason about and implement for this phase.

### Factory enforcement pattern

- Keep low-level publication constructor internal/private.
- Expose public creation only through `Registry` entrypoints that perform uniqueness checks.
- This enforces canonical Morse publications inside this package (while acknowledging other packages can exist).

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

## Planned (not implemented yet)

- [ ] Add `slug` field to `Publication`.
- [ ] Add shared `PublicationRegistry` object.
- [ ] Route publication creation through registry/factory only.
- [ ] Add slug validation rules (format, length, normalization expectations).
- [ ] Add events for slug lifecycle (`SlugRegistered`).
- [ ] Add tests for duplicate slug race behavior and authorization.
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
