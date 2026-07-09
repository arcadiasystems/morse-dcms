# Morse

**Morse is an open, decentralized headless CMS protocol on [Sui](https://sui.io) and [Walrus](https://walrus.xyz).** Content entries are anchored on-chain with Move smart contracts, payloads live in Walrus decentralized storage, access is controlled by [Seal](https://github.com/MystenLabs/seal) threshold encryption — and every revision carries a verifiable on-chain proof. No vendor in the loop.

**Docs: [docs.morsecms.xyz](https://docs.morsecms.xyz)** · Website: [morsecms.xyz](https://www.morsecms.xyz) · X: [@arcadiasysweb3](https://x.com/arcadiasysweb3)

> **Testnet status** — Morse is live on **Sui testnet only**. The contracts are **unaudited**. Sui testnet and Walrus testnet reset periodically (Walrus wipes every few months): stored content and object IDs will be lost on reset, and testnet SUI/WAL have no monetary value. Don't store anything you can't afford to lose.

## Quick start

```sh
# CLI — publish content from your terminal (~5 minutes)
npm install -g @arcadiasystems/morse-cli
morse --help
```

```sh
# TypeScript SDK
npm install @arcadiasystems/morse-sdk @mysten/sui@2.16.2 @mysten/walrus@1.1.6 @mysten/seal@1.1.3
```

Follow the guides: [CLI quick start](https://docs.morsecms.xyz/quick-start-cli.html) · [SDK quick start](https://docs.morsecms.xyz/quick-start-sdk.html) · [Raw contracts (PTBs)](https://docs.morsecms.xyz/quick-start-contracts.html)

Using an AI coding agent? Point it at [docs.morsecms.xyz/llms.txt](https://docs.morsecms.xyz/llms.txt) — every docs page ships a Markdown twin, and the full corpus is one fetch away at [llms-full.txt](https://docs.morsecms.xyz/llms-full.txt). See [Use Morse with AI](https://docs.morsecms.xyz/use-morse-with-ai.html).

## Components

| Component | Status | Where |
|-----------|--------|-------|
| Move contracts | ✅ Active — deployed on Sui testnet (v4) | [`morse-contracts/`](./morse-contracts/) |
| TypeScript SDK | ✅ Active — [`@arcadiasystems/morse-sdk`](https://www.npmjs.com/package/@arcadiasystems/morse-sdk) on npm | [`morse-sdk/`](./morse-sdk/) |
| CLI | ✅ Active — [`@arcadiasystems/morse-cli`](https://www.npmjs.com/package/@arcadiasystems/morse-cli) on npm | [`morse-cli/`](./morse-cli/) |
| Indexer | 📋 Planned — event indexer for read-optimized queries | [`morse-indexer/`](./morse-indexer/) (stub) |
| Content API | 📋 Planned — REST reads for client apps | — |

The contracts are the only source of truth; everything else is replaceable. Any team can integrate against the deployed Move modules directly — the SDK, CLI, and future indexer are ergonomics, not gatekeepers.

## How it works

```
PublicationRegistry            (one shared object — global slug uniqueness)
  Publication                  (identity + permission boundary; OwnerCap / PublisherCap)
    Collection × N             (named content lanes; Blob or Quilt storage mode)
      Entry × N                (stable u64 ids; draft/public head pointers)
        Revision × N           (append-only, immutable; Walrus BlobRef + Seal policy)
```

- **On-chain**: publication identity, write permissions (capability objects), and the full revision history — enforced by Move, auditable by anyone.
- **Walrus**: content payloads and assets, funded per storage epoch and renewable. The contracts store verifiable references, not bytes.
- **Seal**: threshold encryption for gated content — publisher-only drafts and recipient-addressed files.

Read the full model: [Core Concepts](https://docs.morsecms.xyz/core-concepts.html). For the original design deep-dive, see [Morse.md](./Morse.md).

## Repository structure

```
morse-dcms/
├── morse-contracts/   # Sui Move contracts: publication, collection, entry, recipient_file
├── morse-sdk/         # TypeScript SDK (npm: @arcadiasystems/morse-sdk)
├── morse-cli/         # CLI (npm: @arcadiasystems/morse-cli)
└── morse-indexer/     # Event indexer (planned; stub)
```

Each package has its own README with development setup. The SDK's [CHANGELOG](./morse-sdk/CHANGELOG.md) tracks the protocol surface release by release.

## Development

Prerequisites: [Bun](https://bun.sh) ≥ 1.2, [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) and [Task](https://taskfile.dev/) for contract work.

```sh
bun install            # repo root — installs all workspaces

cd morse-sdk           # or morse-cli
bun run lint && bun run typecheck && bun run test && bun run build
```

Contracts (from `morse-contracts/`): `task build`, `task test`, `task publish` (testnet deploy, needs a funded wallet). A localnet workflow (`task localnet` / `task publish:local`) exists for ephemeral local iteration — see the taskfile for the full sequence.

## Feedback

Stuck, confused, or found stale docs? [Open an issue](https://github.com/arcadiasystems/morse-dcms/issues/new) — the docs' "Report an issue" links land here too.

## License

[MIT](./LICENSE)
