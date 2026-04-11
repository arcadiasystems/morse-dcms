# Morse Architecture

## What Morse is

Morse is a decentralized, headless CMS protocol for publishing and evolving structured content on Sui.
It separates **ownership, versioning and authorization** from **content storage and delivery**:

- **Sui Move contracts** define canonical publication state, write permissions, and lifecycle events.
- **Walrus** stores content payloads and assets as blobs, referenced from on-chain entries.
- **Off-chain services** (indexer/API/CLI/SDK) provide ergonomic read/write workflows without becoming the source of truth.

In short, Morse treats the blockchain as the source of truth for *who can change what*, while treating Walrus as the persistence layer for *what is being published*.

## Why the contracts are the core of Morse

The contracts are the protocol boundary: every valid state transition must pass through them.
This gives Morse a deterministic and auditable control plane independent of any specific frontend or backend.

The Move package is responsible for:

- **Publication identity and namespace** via immutable slugs and a global slug registry.
- **Authorization** via explicit capability objects (`OwnerCap`, `PublisherCap`) and holder-bound write checks.
- **Content topology** via `Publication -> Collection -> Entry` with revision pointers (`draft_head`, `public_head`).
- **Event emissions** consumed by indexers to materialize query-friendly views without re-trusting business logic off-chain.

Design consequence:

- If the CLI, SDK, indexer, or API is replaced, the protocol guarantees remain unchanged.
- Off-chain components can optimize UX, latency, and developer ergonomics, but cannot redefine authorization or publication semantics.

## Metadata vs Content

Morse intentionally separates **public metadata** from **content payloads**.

- **Metadata lives on-chain (public, indexable):** publication slug/identity, collection and entry structure, revision heads, authorship provenance, and capability-governed state transitions.
- **Content lives in Walrus blobs:** the actual article/body/media payload referenced by on-chain blob IDs.

This separation provides two important properties:

- **Discoverability and composability:** metadata is always publicly queryable from Sui, so third-party indexers, explorers, and apps can discover and reason about publication state.
- **Flexible access control for payloads:** Walrus content can be plaintext, encrypted, or gated (for example subscription/paywall flows). Even when payload access is restricted, the metadata graph remains visible and verifiable on-chain.

In practice, Morse makes the existence and evolution of content transparent, while allowing the payload itself to follow different distribution and monetization policies.

Analogy: most paywalled media sites still expose the article list, title, author, date, and often a short preview, while the full body is only available to subscribers.
Morse follows the same pattern at protocol level: applications can expose collection/entry listings and metadata publicly, while gating full payload retrieval behind paywalls, authentication, or other access policies.

## Publications

The first thing you usually do in Morse is *create a Publication*.

### What is a Publication

The Publication is the root container for your content. It's a named ('My Blog', 'My Store', 'My Website' etc) of collections ('articles', 'images' etc) with a shared authorization policy.

Example:

- Owner creates a publication with `name = "My Blog"` and `slug = "my-blog"`.

Why these two fields exist:

- `name` is human-facing display metadata.
- `slug` is machine-facing identity metadata used in URLs, API lookups, and cross-system references.

Design choice: slug is immutable after creation.

- If slug were mutable, every consumer (indexer caches, external links, client bookmarks, integrations) would need redirect/reconciliation logic.
- Immutability keeps the publication identity stable and makes indexing deterministic.

### The Publication Registry

What happens in `new_publication(registry, ctx, name, slug)`:

1. Validate slug format.
2. Check uniqueness in registry.
3. Create `Publication` object and return it together with `OwnerCap` and `PublisherCap`. The caller is responsible for sharing the publication (via `share_publication`) and transferring the caps in their PTB.
4. Register `slug -> publication_id` mapping.
5. Emit creation/registration events.

To guarantee global uniqueness of slugs, Morse uses a shared `PublicationRegistry` object as a single on-chain namespace.

Registry responsibility:

- Store canonical mapping: `slug -> publication_id`.
- Reject duplicate slugs at creation time.
- Remove mapping when a publication is deleted.

Why this is required (design rationale):

- Without a registry, two publications could claim `my-blog` in parallel transactions, creating ambiguous routing and broken content discovery.
- A single canonical mapping lets indexers and APIs resolve slugs deterministically without custom conflict logic.
- Making this check on-chain prevents off-chain race conditions (for example two backend workers each believing a slug is available).

Current policy:

- Slugs are unique while active.
- When a publication is deleted, its slug is released and can be reused.

### Publication Authorization

Once a publication exists, the next problem is authorization: who is allowed to change it?

Morse solves this with **capabilities**, not address allowlists embedded in every function.

### Why capabilities

We want authorization to be:

- explicit on-chain objects (auditable and transferable when needed),
- composable with Sui transaction building,
- scoped to one publication.

So Morse uses two capability types:

- `OwnerCap`: admin authority for a publication.
- `PublisherCap`: write authority for content operations in that publication.

Design choice: split admin and publishing powers.

- The owner can delegate publishing without giving away ownership.
- Editorial teams can operate day-to-day without the owner key.

### Owner and Publisher caps

When `new_publication(...)` is called, the creator receives both:

- one `OwnerCap` bound to that publication id,
- one initial `PublisherCap` (also bound to that publication id).

This means a publication starts usable immediately: the creator is both owner and first publisher.

### Adding publishers

Example:

- Owner of `my-blog` wants to let `0xEditor` publish content.

Flow:

1. Owner calls `issue_publisher_cap(publication, owner_cap, holder = 0xEditor, ctx)`.
2. Contract verifies `owner_cap.publication_id == publication.id`.
3. Contract mints a new `PublisherCap` and returns it. No on-chain tracking state is written — caps are valid by construction.
4. Cap can then be delivered to the editor account.

Important design detail:

- A publisher cap is **holder-bound** (`holder: address`).
- During write operations, Morse checks `tx_context::sender(ctx) == cap.holder`.

Why this matters:

- Possessing the cap object is not enough.
- If someone forwards or leaks the cap object, unauthorized addresses still cannot use it.

### How write authorization is enforced

For publisher-gated write operations, Morse checks three conditions:

1. Cap belongs to this publication (`cap.publication_id` matches).
2. Sender is the bound holder address.
3. Cap id is **not** in the revoked denylist (`publication.revoked_publisher_caps`).

The third check is what makes revocation immediate and reliable.

### Revoking publisher access

Revocation model: **denylist, not allowlist**.

`Publication` maintains `revoked_publisher_caps: Table<ID, bool>`, a set of revoked cap IDs. In the common case (no bad actors), this table is empty and has zero maintenance cost. Only revocation events write to it.

Owner-side revocation:

- Owner calls `revoke_publisher_cap(publication, owner_cap, cap_id)`.
- Contract inserts `cap_id` into the revoked denylist.
- Any future write using that cap fails immediately, even if the cap object still exists.
- Double-revoking the same cap aborts with `EPublisherCapRevoked`.

Holder-side cleanup (optional):

- The holder can call `destroy_publisher_cap(publication, cap, ctx)` to delete their cap object.
- If the cap was previously revoked, this also removes it from the denylist (storage reclaim).
- This is optional — publication deletion drops the denylist unconditionally regardless.

Why denylist instead of allowlist:

- Issuing caps is the common path (zero table writes).
- Revocation is an adversarial edge case; paying for it only when it actually happens is more efficient.
- Safe because `PublisherCap` has no `store` ability and no external constructor — caps cannot be fabricated outside the module.

### Transferring ownership

Ownership can be transferred with `transfer_owner_cap(owner_cap, recipient)`.

Why transferability is intentional:

- supports publication sale/hand-off,
- supports operational key rotation,
- keeps ownership logic at protocol level instead of off-chain legal/operational conventions.

## Collections

By default, a newly created publication is structurally valid but functionally empty.
Without collections, there is no content taxonomy, no editorial lanes, and no way to organize entries by intent.

That is why collections are a first-class concept in Morse.

### Why collections matter

A publication is expected to contain multiple collections of similar entries, for example:

- `articles`
- `images`
- `videos`
- `documents`

Each collection acts as a typed editorial bucket (by convention), making downstream systems predictable.

Design benefits:

- clear structure for writers and editors,
- deterministic indexing/querying for APIs and clients,
- simpler access and workflow rules per content lane,
- easier schema evolution over time (new collection types can be added without redesigning the whole publication).

### Collection model in Morse

Inside `Publication`, collections are stored as a named map:

- `collections: VecMap<String, Collection>`

Design choice: `VecMap` at publication level.

- Morse assumes a publication usually has a small number of top-level collections.
- This keeps the model straightforward while still allowing arbitrary collection naming.

### Collection lifecycle

Collections are created through publication entrypoints (publisher-gated), not as an unscoped free-for-all.

- `create_collection(publication, cap, name, storage_mode, ctx)` creates and inserts a collection in one flow (`0 = blob`, `1 = quilt`).
- `delete_collection(publication, cap, name, ctx)` removes and deletes a collection (only when its entries are empty).

Why this matters:

- collection names stay unique per publication,
- collections cannot be attached to the wrong publication,
- deletion is safe and explicit (no silent orphaned entry containers).

## Entries

Collections give structure, but **entries** are where content actually lives.

Example:

- In `articles`, you add entries like `welcome-post`, `roadmap-q2`, `sui-security-notes`.
- In `images`, you add entries like `hero-banner`, `author-avatar`, `cover-photo`.

In other words, a collection defines the lane; entries are the individual content units in that lane.

### Why entries are modeled this way

Each entry in Morse is:

- named (`name`),
- versioned (immutable revisions),
- pointer-based (stores Walrus references, not raw payload bytes on-chain).

Design rationale:

- keeping payload bytes off-chain reduces on-chain footprint,
- immutable revisions give a verifiable history of edits/publications,
- pointer model keeps storage and delivery strategy flexible (plaintext, encrypted, paywalled).

### Entry IDs and stability inside collections

Inside each collection, entries are stored in `Table<u64, Entry>` with monotonic `entry_id` values.

What this means:

- first insert gets `entry_id = 0`, then `1`, then `2`, ...
- deleting an entry does not renumber others,
- gaps are expected (for example `0, 2, 3`).

Why this is important:

- stable ids are indexer/API friendly,
- external references do not break after deletions,
- no hidden reorder side effects.

### Revision model: draft head and public head

Each entry keeps immutable revisions plus two pointers:

- `draft_head`: latest draft revision id (typically encrypted/editorial state),
- `public_head`: latest published revision id (public state).

Supported flows:

- create entry (`new_entry`) with an initial revision,
- append draft (`append_draft_revision`),
- publish from draft (`publish_from_draft`),
- publish direct (`publish_direct`).

Why two heads instead of one status flag:

- draft iteration can continue without mutating current public state,
- publish is an explicit state transition,
- consumers can reliably choose draft vs public view.

### Walrus references and metadata

An entry revision stores:

- `blob_ref`:
  - `Blob(ID)` for standalone Walrus blob object IDs,
  - `QuiltPatch(vector<u8>)` for 37-byte QuiltPatchId (`quilt_blob_id || version || start_index || end_index`),
- `content_type` (MIME metadata),
- `encrypted` flag,
- `access_policy` (`ACCESS_PUBLIC = 0`, `ACCESS_PUBLISHER = 1`, `ACCESS_SUBSCRIPTION = 2`),
- `seal_id` (optional Seal identity for encrypted revisions),
- `author` address.

Important boundary:

- Morse stores references and metadata on-chain.
- Morse does not inline payload bytes in Move state.
- Deleting an entry removes the on-chain reference; it does not automatically delete the Walrus blob.

Walrus validation constraint:

- All production revision-creating functions require the caller to pass `&walrus::blob::Blob`.
- The contract asserts `blob.is_deletable()` before storing a reference, enforcing the platform requirement that stored content must be deletable.
- In blob mode, the stored reference is the blob's Sui object ID. In quilt mode, the stored reference is the 37-byte QuiltPatchId (which embeds quilt blob id + patch coordinates).

### Author provenance

For publication write APIs, Morse binds revisions to transaction sender provenance.

- adding an entry to a collection requires `entry.author == tx_context::sender(ctx)`,
- draft/publish mutations record the sender as the new revision author.

This gives a clean, auditable author trail directly in protocol state.

## Real-world walkthrough: launching a blog on Morse

To make the architecture concrete, here is a realistic end-to-end flow.

### Scenario

Alice is launching a publication called **My Blog** on Morse.
She wants:

- public article pages,
- a private draft workflow with her editor,
- the option to paywall selected posts.

### Step 1: create the publication

Alice creates:

- `name = "My Blog"`
- `slug = "my-blog"`

On-chain result:

- `Publication` shared object is created,
- slug is registered in `PublicationRegistry` (`my-blog -> publication_id`),
- Alice receives `OwnerCap` + initial `PublisherCap`.

Practical effect:

- anyone can resolve `my-blog` to the canonical publication id,
- Alice can immediately start creating content.

### Step 2: define content lanes with collections

Alice creates collections:

- `articles`
- `images`

Why this matters in practice:

- the indexer/API can expose predictable endpoints (for example article listings),
- editorial workflows stay organized by content type.

### Step 3: delegate publishing to an editor

Alice wants Bob (`0xBob`) to help manage content.

- She issues a `PublisherCap` to Bob.
- Bob can now create and update entries.
- Bob still cannot perform owner-only operations (like transferring ownership).

This is the core separation of duties: owner governance vs publisher operations.

### Step 4: publish the first post with draft -> public flow

Bob creates an entry in `articles` named `welcome-post`.

1. Bob uploads draft content to Walrus (can be encrypted) and passes the resulting `Blob` object to create a draft revision. The contract validates it is deletable and stores its ID.
2. `draft_head` moves to the new revision.
3. Bob reviews/edits again by appending another draft revision.
4. When ready, Bob publishes: a new public revision is appended and `public_head` is updated.

Result:

- draft history is preserved,
- public readers get a stable published revision,
- indexers can show publication timeline clearly.

### Step 5: add a paywalled article

Bob publishes another entry, `deep-dive-tokenomics`, with payload access gated.

What users can still see publicly:

- publication and collection structure,
- entry metadata (name, revision lineage, provenance),
- that a new post exists and was published.

What remains restricted:

- full payload retrieval from Walrus, unless the app grants access (subscription/auth).

This mirrors real media sites: discoverability is public, full content can be monetized.

### Step 6: revoke access when team changes

If Bob leaves the team:

- Alice revokes Bob's cap id.
- Bob's future write transactions fail immediately.
- Existing on-chain history remains intact and auditable.

This gives clean offboarding without rewriting history or rotating the whole publication.
