# Morse

**Morse** is a decentralized, headless content management system (dCMS) built on the [Sui](https://sui.io/) blockchain. It separates content management from presentation — storing publication metadata on-chain and raw content encrypted in [Walrus](https://www.walrus.xyz/) decentralized storage, while delivering it to any frontend via an off-chain API.

## Overview

Traditional headless CMSs (Strapi, Ghost, Storyblok) store content in centralized databases and cloud buckets. Morse shifts ownership of content to the blockchain:

- **On-chain** — Publication metadata, collections, and authorization rules live in Move smart contracts on Sui
- **Decentralized storage** — Content and assets are stored encrypted in Walrus
- **Access control** — Managed by [Seal](https://github.com/MystenLabs/seal), enabling paywalls, drafts, and content unpublishing
- **Off-chain delivery** — A centralized indexer and Content API enable human-readable slugs and fast queries

## Repository Structure

```
morse/
├── morse-contracts/          # Sui Move smart contracts
│   └── sources/
│       ├── publication.move  # Publication container + capability model
│       ├── collection.move   # Content collections
│       └── entry.move        # Individual content entries (used in both collections and singletons)
├── morse-cli/                # CLI tool (TypeScript/Bun)
└── morse-indexer/            # Blockchain event indexer (TypeScript/Bun)
```

## Components

| Component | Status | Description |
|-----------|--------|-------------|
| [Move Contracts](./move/publication/) | ✅ Active | On-chain publication, collection, and content management |
| [Morse CLI](./morse-cli/) | ✅ Active | Terminal tool for managing publications on Sui |
| Morse Indexer | 🚧 In Progress | Listens to on-chain events and indexes content off-chain |
| Morse Content API | 📋 Planned | REST API for client apps to read published content |
| Morse SDK | 📋 Planned | TypeScript package wrapping Sui/Walrus/Seal interactions |
| Morse Admin DApp | 📋 Planned | Web UI for managing publications and editors |

## Smart Contracts

The Move contracts implement the core data model on-chain:

- **`Publication`** — Shared top-level container. Holds named `Collection`s and named singleton `Entry`s. Created by the owner; write access is gated by `OwnerCap` / `PublisherCap`.
- **`Collection`** — A named group of `Entry` items, stored in a `Table<u64, Entry>`. Wrapped inside `Publication`.
- **`Entry`** — A named pointer to an on-chain Walrus Blob object (`blob: ID`), with an `entry_type` (MIME type). Used for both collection items and publication-level singletons.

**Capability model:** creating a publication mints an `OwnerCap` (required to issue `PublisherCap`s and delete the publication) and a `PublisherCap` (required for all write operations). Multiple `PublisherCap`s can exist per publication; only the owner can issue them.

All modules emit events so the indexer can track state without scanning the full chain.

**Testnet deployment:**
```
Package:  0x73e659e3a437ab4ba74c549da7c04b9e902b4c545398f6039c101b2e5e1ec03a
Chain ID: 4c78adac (Sui testnet)
```

## Getting Started

### Prerequisites

- [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) — for building and deploying Move contracts
- [Bun](https://bun.sh/) v1.2+ — for the CLI and indexer

### Move Contracts

```bash
cd morse-contracts

# Build
task build

# Run tests
task test

# Deploy to testnet (requires a funded Sui testnet wallet)
task publish
```

#### Local development

To iterate locally without touching testnet, use the localnet workflow. `build` and `test` must run while the testnet environment is active — Sui requires the chain ID to be hardcoded in `Move.toml` otherwise, which we avoid.

```bash
task localnet        # terminal 1 — keep running
task faucet          # terminal 2 — wait ~60s for coins
task publish:local   # switches to localnet, publishes ephemerally, does not update Published.toml
task clean           # delete the ephemeral Pub.local.toml
task switch:testnet  # switch back so build/test work again
```

If `publish:local` fails with a chain-id mismatch, run `task clean` first (stale file from a previous localnet session).

### Morse CLI

```bash
cd morse-cli
bun install
```

Create a `.env` file in `morse-cli/`:

```env
PRIVATE_KEY=<your-ed25519-private-key>
PUBLICATION_ADDRESS=<deployed-package-address>
ORIGINAL_PUBLICATION_ADDRESS=<original-package-id>
```

**Commands:**

```bash
# Create a new publication
bun run index.ts pub create --name "My Blog"

# List all publications you own
bun run index.ts pub list

# Get a specific publication by ID
bun run index.ts pub get --id <publication-id>

# Delete a publication
bun run index.ts pub delete --id <publication-id>
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | [Sui](https://sui.io/) (Move 2024) |
| Decentralized Storage | [Walrus](https://www.walrus.xyz/) |
| Access Control | [Seal](https://github.com/MystenLabs/seal) |
| CLI / Indexer | [Bun](https://bun.sh/) + TypeScript |
| Network | Sui Testnet |

## Roadmap

- [x] Move smart contracts (Publication, Collection, Entry, Publisher capability model)
- [x] Morse CLI (publication CRUD)
- [ ] Morse Indexer
- [ ] Morse Content API
- [ ] Morse SDK
- [ ] Morse Admin DApp
- [ ] Demo publishing website
