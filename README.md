# Morse

**Morse is an open, decentralized headless CMS protocol on [Sui](https://sui.io) and [Walrus](https://walrus.xyz).** Content entries are anchored on-chain with Move smart contracts, payloads live in Walrus decentralized storage, access is controlled by [Seal](https://github.com/MystenLabs/seal) threshold encryption — and every revision carries a verifiable on-chain proof. No vendor in the loop.

**Docs: [docs.morsecms.xyz](https://docs.morsecms.xyz)** · Website: [morsecms.xyz](https://www.morsecms.xyz) · X: [@arcadiasysweb3](https://x.com/arcadiasysweb3)

> **Status** - Morse is live on **Walrus Mainnet and testnet**. Deployment addresses for both are in [`morse-contracts/Published.toml`](./morse-contracts/Published.toml) and ship baked into the SDK and CLI.
>
> On mainnet, gas and Walrus storage cost real SUI and WAL, there is no faucet, and deletions are irreversible.
>
> What has been verified, as recorded in the [SDK changelog](./morse-sdk/CHANGELOG.md): the full smoke suite passes on Testnet only, most recently with SDK 0.9.0 on 2026-10-18. On Walrus Mainnet, the SDK 0.6.0 smoke run on 2026-09-09, through the Walrus upload relay, verified publications, publisher caps, collections (blob and quilt), Walrus blob and quilt uploads, and the entry lifecycle in both collection modes. SDK 0.8.2 recorded a browser round trip on Walrus Mainnet on 2026-09-11 through `@arcadiasystems/morse-uploader`: a wallet-signed upload via the Walrus upload relay, then the same blob read back byte for byte from the Walrus Mainnet aggregator. The SDK 0.9.0 checks ran on Testnet only. Size your first deployment accordingly.
>
> On testnet, Sui and Walrus reset periodically (Walrus wipes every few months): stored content and object IDs will be lost on reset, and testnet SUI/WAL have no monetary value. Don't store anything you can't afford to lose.

## Quick start

```sh
# CLI — publish content from your terminal (~5 minutes)
npm install -g @arcadiasystems/morse-cli
morse --help
```

```sh
# TypeScript SDK
npm install @arcadiasystems/morse-sdk @mysten/sui@2.36.0 @mysten/walrus@1.2.35 @mysten/seal@1.5.0
```

Follow the guides: [CLI quick start](https://docs.morsecms.xyz/quick-start-cli.html) · [SDK quick start](https://docs.morsecms.xyz/quick-start-sdk.html) · [Raw contracts (PTBs)](https://docs.morsecms.xyz/quick-start-contracts.html)

Using an AI coding agent? Point it at [docs.morsecms.xyz/llms.txt](https://docs.morsecms.xyz/llms.txt) — every docs page ships a Markdown twin, and the full corpus is one fetch away at [llms-full.txt](https://docs.morsecms.xyz/llms-full.txt). See [Use Morse with AI](https://docs.morsecms.xyz/use-morse-with-ai.html).

## Components

| Component | Status | Where |
|-----------|--------|-------|
| Move contracts | ✅ Active - deployed on mainnet (v1) and testnet (v4) | [`morse-contracts/`](./morse-contracts/) |
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

Contracts (from `morse-contracts/`): `task build`, `task test`, `task publish`, `task upgrade`. `task publish` and `task upgrade` both run against whichever Sui environment is currently active and need a funded wallet there, so check `sui client active-env` first.

`task publish` is for a new deployment only. It runs `sui client publish`, which creates a new package and updates `Published.toml`, and the package's `init` creates a new `PublicationRegistry`. Do not run it to change the live mainnet or testnet packages: it would create a second, separate deployment, not a new version of the live one. Changes to the live packages ship as a package upgrade. `task upgrade` runs `sui client upgrade` against the active environment, and `Published.toml` records each network's `upgrade-capability`. After an upgrade, update `KNOWN_DEPLOYMENTS` in [`morse-sdk/src/config.ts`](./morse-sdk/src/config.ts) to match `Published.toml`, since the SDK and CLI read their addresses from it.

A localnet workflow (`task localnet` / `task publish:local`) exists for ephemeral local iteration; see the taskfile for the full sequence.

## Feedback

Stuck, confused, or found stale docs? [Open an issue](https://github.com/arcadiasystems/morse-dcms/issues/new) — the docs' "Report an issue" links land here too.

## License

[MIT](./LICENSE)
