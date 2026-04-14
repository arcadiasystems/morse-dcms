# Morse dCMS

Canonical stakeholder and technical document for the **Morse protocol**.

## Executive Summary

Morse is a **decentralized, headless CMS protocol** built on Sui and Walrus.

At a high level, Morse separates:

- content governance (who can create/update/publish), and
- content storage and delivery (where payloads live, and how apps read them).

Morse makes publication metadata public and queryable on-chain (so anyone can discover structure and state), while access to specific document payloads can be gated by policy (for example paywalls or allowlists).

Why this matters:

- Governance and authorization are transparent, auditable, and enforced on-chain.
- Metadata remains publicly accessible and composable for indexing and discovery.
- Content payloads and assets are stored in Walrus, not directly in blockchain state.
- Payload retrieval can be **restricted by access policy** instead of forcing all content to be globally readable.
- Frontends and APIs can evolve without changing core protocol guarantees.

Morse is designed to support both public publishing and gated publishing models. Today, the contracts already include public and publisher access policies. Subscription policy is represented and planned for near-term implementation in end-to-end product flows. Additional policies can be added on demand.

> 💡 Morse is also **agent-first**: coding agents can use CLI and SDK workflows to design, provision, and evolve their backend publishing/API layer directly on Sui and Walrus, paying for computation and storage on-demand, on-chain.

## What Problem Morse Solves

Traditional headless CMS products usually centralize identity, authorization, and data in one vendor backend.

That model is fast to start with, but it creates several long-term constraints:

- trust concentration in one backend,
- weaker portability of publication identity and permissions,
- higher lock-in risk for publishers,
- opaque change and authorization history.
- limited integration options, usually a closed-source system

Morse keeps the ergonomics of headless CMS architecture while moving the core control plane on-chain.

The result is a **decentralized protocol** where:

- publication identity is canonical,
- write permissions are capability-based and verifiable,
- content state transitions are deterministic and auditable,
- off-chain services improve UX but are not the source of truth, anyone can develop their own integration and roll-their-own CMS infra.

## CMS and Headless CMS Basics (Why This Model Exists)

### What is a CMS?

A content management system lets teams create, organize, update, and publish digital content and assets without directly hardcoding every page.

### What is content?

Content is structured information that apps can parse and render. Examples include:

- articles,
- product entries,
- landing page blocks,
- navigation structures,
- structured JSON documents.

In Morse, content shape is not constrained by Walrus itself: Walrus stores binary blobs. The client/application decides how to interpret those bytes (for example JSON, markdown, images, video, custom schemas, or other formats).

### What are assets?

Assets are static files used by content and apps, such as images, videos, audio, and documents.

### What is a headless CMS?

A headless CMS separates content management from presentation.

- The CMS manages content and metadata.
- Client applications decide how to render it.
- Content is delivered through APIs and consumed by web, mobile, and other clients.

This is the model Morse keeps, while decentralizing identity, authorization, and state transitions.

## Why Morse Is Different

Morse is not just a CMS app. It is a protocol-plus-product architecture.

It is intentionally compatible with autonomous development workflows: an agent can define content structures, publish and update content state, and operate backend primitives through programmable interfaces without waiting for centralized backend provisioning.

Core distinction:

- Smart contracts define canonical publication state and write rules.
- Walrus stores payload data and assets.
- Off-chain services (indexer/API/SDK/CLI/Admin DApp) provide ergonomics and developer experience.

In other words:

- blockchain answers who can do what,
- storage answers what payload is referenced,
- off-chain services answer how developers and users interact conveniently.

## System Overview

Morse is composed of several components with different responsibilities.

### 1) Morse Contracts (source of truth)

**What it is:** the protocol core deployed on Sui.

**Why it matters:** this layer defines canonical validity for writes and state transitions.

Enforces:

- publication creation and slug uniqueness,
- authorization through capabilities,
- collection and entry lifecycle,
- revision and publish state transitions,

### 2) Walrus (payload storage)

**What it is:** decentralized blob storage for content payloads and assets.

**Why it matters:** keeps large payload bytes off-chain while preserving on-chain verifiable references.

Walrus is format-agnostic at the storage layer (binary blob in, binary blob out), so Morse can support arbitrary data types. Interpretation and rendering are client responsibilities.

The contracts store references to payloads, not payload bytes.

### 3) Indexer + API (read layer)

**What it is:** read-optimized services that index protocol state/events and serve query-friendly responses.

**Why it matters:** most real products need fast listing/search/filter reads that are impractical to do directly from raw chain data.

### 4) SDK

**What it is:** developer integration layer for contract and content workflows.

**Why it matters:** speeds up integration and reduces implementation mistakes for app teams and coding agents.

### 5) CLI

**What it is:** command-line workflow surface for protocol operations.

**Why it matters:** enables scripted automation, CI usage, and agent-native backend operations.

This is particularly important for coding-agent workflows where CLI-native actions are the execution surface for building and operating backend functionality.

### 6) Admin DApp / Client apps

**What it is:** product-facing applications for editors and readers.

**Why it matters:** this is where protocol capability becomes usable publishing UX.

> 💡 Even where some product components are centralized (for example hosted API/indexer deployments), Morse remains an open protocol: any team can integrate directly with the smart contracts, run their own supporting services, and use the SDK as a convenient integration layer. This avoids hard vendor lock-in.

## Design Principles

Morse follows these principles:

1. **Contracts** are the canonical control plane.
2. **Metadata** should be public and indexable.
3. Payload bytes should live off-chain in **decentralized storage**.
4. **Authorization** should be explicit and capability-based.
5. **Revision history** should be immutable and auditable.
6. **Off-chain components** should be replaceable without changing protocol guarantees.
7. **Agent-first** operation should be possible through programmable interfaces (CLI/SDK/contracts).

## Conceptual Model (Publication -> Collection -> Entry -> Revision)

Before the contract-level detail, this is the simplest way to think about Morse:

- Publication: a site/brand-level container (for example `my-blog`).
- Collection: a content lane inside that publication (for example `articles`, `site-pages`).
- Entry: one content unit in a collection (for example `welcome-post`).
- Revision: an immutable saved version of that entry over time.

Editors operate mostly at the entry/revision level. Owners operate mostly at the publication/authorization level.

## Current Protocol Model

This section reflects the current Sui Move contract behavior.

### Publication Layer

**What it is:** a Publication is the top-level container for one content domain in Morse.

**Why it matters:** it gives a stable identity and governance boundary for all collections, entries, and permissions under that domain.

Example: `name = "My Blog"`, `slug = "my-blog"`.

It contains:

- publication display metadata (`name`),
- immutable canonical slug (`slug`),
- named collections (`VecMap<String, Collection>`),
- revoked publisher-cap denylist.

`PublicationRegistry` is a shared global namespace that enforces **slug uniqueness** among active publications.

### Authorization Layer

**What it is:** the authorization layer is a **capability-based** permission model for controlling who can administer a publication and who can publish content.

**Why it matters:** it separates ownership from day-to-day publishing, enables safe delegation to editors, and supports immediate revocation when access must be removed.

> 💡 **Example**: an owner issues a `PublisherCap` to an editor address, the editor publishes content, and the owner can revoke that cap if the editor leaves the team.

Morse uses two capabilities:

- `OwnerCap`: administrative authority (issue/revoke publisher caps, delete publication, transfer ownership).
- `PublisherCap`: publishing authority for collection and entry write operations.

Client perspective (how teams actually use this):

1. The publication owner wallet holds `OwnerCap`.
2. From the Admin DApp/CLI/API flow, the owner can issue a `PublisherCap` to an editor address.
3. That editor can create collections/entries and publish content for that specific publication.
4. If access must be removed (team change, compromise, role update), the owner revokes that cap by id.
5. Revocation is immediate for future writes, without rewriting historical content state.

Publisher capabilities are holder-bound. During writes, contracts verify:

- cap belongs to target publication,
- transaction sender matches cap holder,
- cap id is not revoked.

Revocation model is **denylist-based**, optimized for the common case where no revocations occur. This gives client apps a simple mental model: issue access when onboarding editors, revoke access instantly when offboarding.

### Collection Layer

**What it is:** a collection is a named content lane inside a publication (for example articles, docs, images).

**Why it matters:** it organizes content into predictable buckets for editorial workflows and for indexer/API consumers.

> 💡 **Example**: publication `my-blog` can have collections like `articles` and `site-pages`, each with its own storage mode.

A publication contains named collections.

Collections are created through `create_collection(...)` with immutable `storage_mode`:

- `0` = blob mode,
- `1` = quilt mode.

❓ **When to use each mode:**

- Use **blob mode** for dynamic collections that grow continuously (for example articles, posts, docs, media libraries). Each revision points to an independent blob, which is operationally simpler when content units change independently.
- Use **quilt mode** for smaller, more stable collections where patch-based addressing is useful (for example website sections, config-like structured documents, or compact content sets updated in place).
- **Rule of thumb:** if you expect frequent independent item churn, choose blob mode. If you expect relatively static grouped content with targeted patch updates, choose quilt mode.

Entries inside each collection are keyed by monotonic `entry_id` (`u64`) and stored in a table.

IDs are stable and not renumbered after deletions.

### Entry and Revision Layer

**What it is:** an entry is a single content unit inside a collection, and revisions are immutable versions of that entry over time.

**Why it matters:** this enables safe editing, auditable history, and stable public delivery while drafts continue to evolve.

> 💡 Example: entry `welcome-post` can move from initial revision to multiple draft revisions, then to a published revision without deleting earlier history.

Versioning is a core Morse concept, not an optional add-on.

Why versioning matters:

- Auditability: every content change is recorded as a new immutable revision, so teams can prove what changed and when.
- Editorial safety: draft work can evolve without overwriting currently published content.
- Stable reads: clients can reliably read the latest public state while editors keep iterating privately.
- Recovery and governance: accidental or bad updates do not erase history; a new revision can supersede old ones.

Each entry has:

- `name`,
- immutable revision vector,
- `draft_head`,
- `public_head`.

How versioning works in practice:

1. An entry starts with an initial revision.
2. New edits append revisions (never mutate old ones).
3. `draft_head` points to the latest draft-oriented revision.
4. `public_head` points to the currently published revision.
5. Publishing appends a new public revision and advances `public_head`.

This dual-head model (`draft_head` + `public_head`) is what enables real editorial workflows: teams can work ahead in draft mode while production clients continue serving stable published content.

Each revision includes:

- `blob_ref`,
- `content_type`,
- `encrypted`,
- `access_policy`,
- optional `seal_id`,
- `author`.

`blob_ref` is an enum:

- `Blob(ID)` for standalone blob references,
- `QuiltPatch(vector<u8>)` for 37-byte quilt patch identifiers.

## Storage Strategy (Technical Reference)

Collection mode selection is explained in `Collection Layer`. This section captures implementation specifics:

- Blob mode stores `Blob(ID)` references.
- Quilt mode stores `QuiltPatch(vector<u8>)` references.
- Quilt patch identifiers are 37 bytes: 32-byte quilt blob id, 1-byte version, 2-byte start index, 2-byte end index.
- Contract write paths validate that the supplied blob object is deletable before storing references.

## Access Policies and Encryption

Current access policy constants are:

- `ACCESS_PUBLIC = 0`
- `ACCESS_PUBLISHER = 1`
- `ACCESS_SUBSCRIPTION = 2`

Current practical status:

- Public metadata visibility and policy fields are part of the protocol model today.
- Encrypted revision semantics (including `seal_id` validation invariants) are implemented at the contract layer.
- Publisher-oriented access policy is implemented in protocol semantics.
- Subscription policy exists in the protocol surface and is the next planned end-to-end policy implementation.
- Additional policy types are expected to be added on demand.

> 💡 Web2 analogy (important): in many paywalled blogs, users can browse the public article list and metadata, but cannot read the full article body until they pay. Morse follows the same pattern at protocol level: metadata remains publicly discoverable, while document payload access can be gated via policy, including the planned subscription policy.

This gives Morse a policy-extensible foundation without forcing one monetization model.

## Lifecycle and Workflow

Typical flow:

1. Create publication with slug.
2. Share publication object and distribute capabilities.
3. Create one or more collections with chosen storage mode.
4. Add entries to collections.
5. Evolve entries using draft and publish flows.
6. Revoke publishers if needed without mutating historical records.

Revision operations support:

- append draft revision,
- publish from draft,
- publish direct.

This enables editorial iteration while preserving immutable history and a stable published head for readers.

## Events and Indexing Model

Contracts emit events for major state transitions, including publication lifecycle, slug lifecycle, publisher cap issuance/revocation, and collection add/remove operations.

Indexers consume this stream to build read-optimized views.

Design intent:

- write path is protocol-verified,
- read path is optimized off-chain,
- indexer/API can be replaced without changing canonical validity rules.

## Current State vs Planned State

### Implemented now (contract source-of-truth)

- publication + slug registry model,
- owner/publisher capability model,
- revocation denylist,
- collection lifecycle,
- collection storage mode selection,
- entry revisions with blob/quilt references,
- draft/public heads,
- access policy representation,
- extensive Move unit test coverage.

### Planned / in progress (product layer)

- production-grade indexer and content API interfaces,
- production-grade SDK and CLI interfaces,
- polished admin application workflows,
- subscription-gated policy support in end-to-end product behavior,
- additional policy modules based on product demand.

## Business Framing

Morse can support multiple business models because protocol governance and product UX are decoupled.

### Cost model (current)

- Users pay chain gas for protocol writes.
- Storage and service operators still incur infrastructure costs for API/indexer/app hosting.

### Revenue model options

Potential models include:

- protocol-level transaction fees,
- SaaS-style fees in managed off-chain services,
- take-rate on subscription/paywalled ecosystems,
- premium managed tooling for teams and enterprises.

No single model is hardcoded into protocol architecture today; this is a strategic product choice.

## Why Stakeholders Should Care

Morse offers a credible middle path between pure web2 CMS convenience and pure protocol minimalism:

- stronger trust and portability at the governance layer,
- familiar headless architecture for product teams,
- natural fit for coding-agent workflows and autonomous development,
- extensible policy model for future monetization,
- clear separation between canonical truth and service UX.

Open-protocol implication:

- centralized service deployments can exist for convenience,
- but protocol access is not gated by a single vendor backend,
- integrators can build directly on contracts (and optionally the SDK), reducing lock-in risk.

Agent-first implication:

- teams can let coding agents design and deploy backend API behavior against Morse contracts and Walrus,
- infra scales in an on-demand manner with on-chain payment semantics for computation and storage,
- less reliance on fixed backend ops cycles for early product iteration.

That makes Morse relevant for media, creator platforms, commerce content systems, and developer ecosystems that need both flexible delivery and durable governance.

## ⚠️ Risks and Tradeoffs

Morse deliberately accepts certain tradeoffs:

- **Partial decentralization:** off-chain indexers/APIs are still needed for practical UX.
- **Uneven maturity:** contracts are strong; some surrounding components are still being built.
- **Policy growth complexity: **more access/monetization policies increase integration and UX complexity.
- **Slug reuse tradeoff:** flexible, but can introduce identity continuity concerns if unmanaged at product layer.
- **Gas costs:** decentralization implies gas fees and on-chain transactions. Since we don't want to centralize, we plan to solve this problem in the future with blockchain-native solutions such as embedded wallets and gas sponsorship.
- **Performance:** using on-chain metadata + content in decentralized storage comes with performance consequences in a world where people expect responses returned in the order of milliseconds. 

These are manageable tradeoffs and are typical in pragmatic decentralized product architecture.

## End-to-End Example (Concrete)

Example: a publisher launches a content brand on Morse.

1. Owner creates publication `my-brand`.
2. Owner receives `OwnerCap` and initial `PublisherCap`.
3. Owner creates `articles` collection in blob mode and `site-pages` in quilt mode.
4. Editor receives publisher cap and starts drafting entries.
5. Editor appends drafts, then publishes to update `public_head`.
6. API/indexer exposes public metadata and resolves payload references for readers.
7. Owner revokes editor cap when needed; further writes are blocked immediately.

All state transitions remain auditable, and reader-facing clients can continue to evolve independently.

## Glossary

- **CMS:** software for managing and publishing structured digital content.
- **Headless CMS:** CMS with no built-in presentation layer; delivery is API-first.
- **Publication:** top-level Morse content domain.
- **Collection:** named content lane inside a publication.
- **Entry:** content unit in a collection.
- **Revision:** immutable version of an entry.
- **Draft head:** latest draft revision pointer.
- **Public head:** latest published revision pointer.
- **OwnerCap:** admin capability for publication governance.
- **PublisherCap:** write capability for publication content operations.
- **Walrus blob:** decentralized payload object stored off-chain from contract state.
- **BlobRef:** revision pointer enum (`Blob` or `QuiltPatch`).
- **QuiltPatchId:** compact patch identifier used in quilt storage mode.

## Canonicality Statement

This document is the canonical product and architecture overview for Morse.

For exact protocol-level behavior and invariants, contract source code is the canonical specification:

- `morse-contracts/sources/publication.move`
- `morse-contracts/sources/collection.move`
- `morse-contracts/sources/entry.move`
