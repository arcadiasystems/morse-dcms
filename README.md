# Morse dCMS

Morse is a **decentralized, headless content management system (dCMS)** built on the [Sui](https://sui.io/) blockchain. 

It separates content management from presentation - storing **publication metadata** on-chain and **raw content** (optionally encrypted) in [Walrus](https://www.walrus.xyz/) decentralized storage, while delivering it to any frontend via an off-chain API.

## Overview
> 💡 For an in-depth explanation, check out [Morse.md](./Morse.md)

Traditional headless CMSs (Strapi, Ghost, Cockpit) store content in centralized databases and cloud buckets. Morse shifts ownership of content to the blockchain:

- **On-chain** - Publication metadata, collections, and authorization rules live in Move smart contracts on Sui
- **Decentralized storage** - Content and assets are stored encrypted in Walrus
- **Access control** - Managed by [Seal](https://github.com/MystenLabs/seal), enabling paywalls, drafts, and content unpublishing
- **Off-chain delivery** - A centralized indexer and Content API enable human-readable slugs and fast queries
- **Open for integration**: Morse is an open-protocol and you can use our SDK to integate without being locked in by our centralized infra.



## Repository Structure

```
morse/
├── morse-contracts/          # Sui Move smart contracts
│   ├── sources/
│   │   ├── publication.move  # Publication container + capability model
│   │   ├── collection.move   # Content collections
│   │   └── entry.move        # Individual content entries with blob/quilt revision model
│   └── tests/
│       ├── publication_tests.move
│       ├── collection_tests.move
│       └── entry_tests.move
├── morse-cli/                # CLI tool (TypeScript/Bun)
│   ├── commands/             # Subcommands: publication, collection, entry, asset, singleton
│   └── index.ts              # Entry point
├── morse-indexer/            # Blockchain event indexer (TypeScript/Bun)
└── morse-sdk/                # TypeScript SDK (in development)
```

## Components

| Component | Status | Description |
|-----------|--------|-------------|
| [Move Contracts](./move/publication/) | ✅ Active | On-chain publication, collection, and content management |
| [Morse CLI](./morse-cli/) | 🚧 In Progress| Terminal tool for managing publications on Sui |
| Morse Indexer | 📋 Planned  | Listens to on-chain events and indexes content off-chain |
| Morse Content API | 📋 Planned | REST API for client apps to read published content |
| Morse SDK | 📋 Planned | TypeScript package wrapping Sui/Walrus/Seal interactions |
| Morse Admin DApp | 📋 Planned | Web UI for managing publications and editors |

## Getting Started

### Prerequisites

- [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) - for building and deploying Move contracts
- [Bun](https://bun.sh/) v1.2+ - for the CLI and indexer
- [Task](https://taskfile.dev/) - Task is a modern task runner

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | [Sui](https://sui.io/) (Move 2024) |
| Decentralized Storage | [Walrus](https://www.walrus.xyz/) |
| Access Control | [Seal](https://github.com/MystenLabs/seal) |
| CLI / Indexer | [Bun](https://bun.sh/) + TypeScript |
| Network | Sui Testnet |
