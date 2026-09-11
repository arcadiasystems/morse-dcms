# morse-sdk

TypeScript SDK for [Morse](https://github.com/arcadiasystems/morse-dcms/tree/main/morse-contracts), a decentralized content management system on the Sui blockchain. Wraps the Move contract surface, Walrus storage, and Seal threshold encryption behind a typed adapter pattern.

## Status

Pre-release. Mainnet and testnet are both wired: the Move contract addresses are baked in, so `morseConfig({ network: "mainnet" })` and `morseConfig({ network: "testnet" })` both return a complete config with no addresses to supply.

**Encrypted content needs your own Seal key servers on mainnet.** Public publications, collections, entries and files work out of the box on both networks. Encryption does not, on mainnet: every mainnet Seal operator is commercial, including Mysten's committee aggregator, which rejects unauthenticated requests. `DefaultSealAdapter.fromMorseConfig` therefore throws `ConfigurationError` on mainnet until you supply `serverConfigs`. See [Network configuration](#network-configuration).

**The contracts are unaudited.** On mainnet, SUI and WAL cost real money, there is no faucet, and a mistake is not recoverable. The publication lifecycle and the Walrus paths are verified end to end on mainnet; Seal is not, because mainnet has no key servers this SDK can reach without commercial credentials (see [Compatibility](#compatibility)). Treat mainnet as usable but young, and size your first deployment accordingly.

## Install

All three Mysten packages are required peer dependencies. Pin the minors the SDK is verified against (see [Compatibility](#compatibility)):

Bun:

```sh
bun add @arcadiasystems/morse-sdk @mysten/sui@2.16.2 @mysten/walrus@1.1.6 @mysten/seal@1.1.3
```

npm:

```sh
npm install @arcadiasystems/morse-sdk @mysten/sui@2.16.2 @mysten/walrus@1.1.6 @mysten/seal@1.1.3
```

pnpm:

```sh
pnpm add @arcadiasystems/morse-sdk @mysten/sui@2.16.2 @mysten/walrus@1.1.6 @mysten/seal@1.1.3
```

`@mysten/sui` provides the client, keypairs, and transaction types; `@mysten/walrus` backs the default storage adapters (any publish path needs it); `@mysten/seal` backs threshold encryption. All three are imported by the SDK's public surface, so they must be installed even if you only use a subset — npm 7+ installs required peers automatically when you omit them.

## Compatibility

morse-sdk is built and tested against specific minor versions of its Mysten substrate. Newer or older versions are not validated and may produce runtime errors. The peer-dependency ranges in `package.json` enforce these bounds — `bun install` will warn if you try to use a different minor.

| morse-sdk | `@mysten/sui` | `@mysten/walrus` | `@mysten/seal` | Sui network | Verified  |
| --------- | ------------- | ---------------- | -------------- | ----------- | --------- |
| 0.8.x     | 2.16.2-2.16.x | 1.1.6-1.1.x      | 1.1.3-1.1.x    | testnet     | 2026-09-09 |
| 0.7.x     | 2.16.2-2.16.x | 1.1.6-1.1.x      | 1.1.3-1.1.x    | testnet     | 2026-09-09 |
| 0.6.x     | 2.16.2-2.16.x | 1.1.6-1.1.x      | 1.1.3-1.1.x    | testnet     | 2026-09-09 |
| 0.5.x     | 2.16.2-2.16.x | 1.1.6-1.1.x      | 1.1.3-1.1.x    | testnet     | 2026-06-05 |
| 0.4.x     | 2.16.2-2.16.x | 1.1.6-1.1.x      | 1.1.3-1.1.x    | testnet     | 2026-06-05 |
| 0.1.x     | 2.16.2-2.16.x | 1.1.6-1.1.x      | 1.1.3-1.1.x    | testnet     | 2026-05-10 |

Mysten ships breaking changes inside major version boundaries. Newer minors (e.g. `@mysten/walrus@1.2.x`, `@mysten/sui@2.17+`) are outside the verified ranges and may produce runtime errors; morse-sdk needs a coordinated bump and re-verification before a new Mysten minor is supported. Pin via `bun add @arcadiasystems/morse-sdk@~0.8.0` if you want patch updates without surprise minors.

The verification protocol is documented in [`CONTRIBUTING.md`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/CONTRIBUTING.md): every Mysten dep bump runs the full `scripts/phase-N-*.ts` smoke suite before the bump lands.

The `Sui network` column records where the suite passes **in full**, which is testnet. Most of it also passes on mainnet: publications, publisher caps, collections, Walrus blob and quilt uploads, and the entry lifecycle in both collection modes were all verified against live mainnet on 2026-09-09. A browser round trip was verified separately on 2026-09-11, through [@arcadiasystems/morse-uploader](https://www.npmjs.com/package/@arcadiasystems/morse-uploader): a wallet-signed upload via the Walrus upload relay, then the same blob read back byte for byte from the mainnet aggregator. The two Seal phases cannot run on mainnet, because it has no key servers this SDK can reach without commercial credentials, so mainnet has no fully green run to record. `TESTED_SUBSTRATE.suiNetwork` reports the same thing programmatically.

### Runtime requirements

morse-sdk is ESM-only (`"type": "module"` in `package.json`); CommonJS `require` is not supported.

| Runtime | Supported | Notes                                                                                                                                            |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bun     | >= 1.2.0  | Primary development runtime. Enforced via `engines.bun`. Smoke scripts (`bun run scripts/phase-N-*.ts`) require Bun.                              |
| Node    | >= 18.0   | Enforced via `engines.node`. Library code uses ES2022 features (private class fields, `Error.cause`), `TextEncoder` / `crypto.getRandomValues` / `BigInt` (all stable on Node 18+). Consumers install with `npm install @arcadiasystems/morse-sdk` or `pnpm add`. |
| Browser | Evergreen | Chrome / Edge / Firefox / Safari recent stable. Bundlers (Vite, Webpack, esbuild) handle the rest. No `require`-based polyfills needed.            |

The SDK does not pull in Node-specific APIs (`fs`, `path`, `process`, `crypto` from `node:crypto`); the public surface is portable across both runtimes. A handful of `@mysten/*` substrate libraries reach into Node-shaped APIs internally — consult their documentation for browser polyfill requirements (typically zero with modern bundlers).

## Quick start

Setup once at startup:

```ts
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  KeypairAdapter,
  morseConfig,
  RpcPublicationReader,
} from "@arcadiasystems/morse-sdk";

// The quick start uses testnet on purpose: every step below spends gas and
// WAL, and on mainnet that is real money. Switch both literals to "mainnet"
// once the flow works for you.
const config = morseConfig({ network: "testnet" });
const client = new SuiGrpcClient({ network: "testnet", baseUrl: config.rpcUrl });
const keypair = Ed25519Keypair.fromSecretKey(privateKey); // Bech32 "suiprivkey1..."
const adapter = new KeypairAdapter(keypair, client);
// Browser apps swap KeypairAdapter for a WalletAdapter impl against the
// connected wallet's signer - see "Adapter pattern" below.
const reader = RpcPublicationReader.fromMorseConfig(config, client);
```

Then create a publication, add an entry, read it back:

```ts
import {
  addEntryFromBytes,
  createCollection,
  createPublication,
  DefaultWalrusWriteAdapter,
  StorageMode,
} from "@arcadiasystems/morse-sdk";

// Slugs are globally unique on-chain (like usernames) - make yours
// collision-proof rather than copying a fixed example value.
const created = await createPublication(adapter, config, {
  name: "My Publication",
  slug: `my-pub-${Date.now()}`,
});
await createCollection(adapter, config, {
  publicationId: created.publicationId,
  publisherCapId: created.publisherCapId,
  name: "blog",
  storageMode: StorageMode.Blob,
});

const walrus = DefaultWalrusWriteAdapter.fromConfig(
  { network: "testnet", suiClient: client },
  keypair,
);

const entry = await addEntryFromBytes(adapter, config, {
  walrus,
  publicationId: created.publicationId,
  publisherCapId: created.publisherCapId,
  collectionName: "blog",
  name: "first-post",
  bytes: new TextEncoder().encode("hello world"),
  contentType: "text/plain",
  upload: { epochs: 3, deletable: true },
});
const fetched = await reader.getEntry(created.publicationId, "blog", entry.entryId);
```

`addEntryFromBytes` runs in **2 wallet popups** (one for `register_blob`, one for the combined `certify_blob + add_entry_to_collection` PTB) instead of the 3 popups a separate `uploadBlob` + `addEntry` would emit. See "Choosing the right entry path" below for when to prefer the lower-level split form.

The compile-checked end-to-end version is in [`examples/quickstart.ts`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/quickstart.ts).

## Walrus access patterns

morse-sdk ships two pairs of Walrus adapters. They implement the same interfaces (`WalrusReadAdapter`, `WalrusWriteAdapter`) and the rest of the SDK is unchanged whichever pair you pick.

| Pair                                                              | Trust model      | Browser CORS    | Popup count for upload + addEntry | Storage cost paid by |
| ----------------------------------------------------------------- | ---------------- | --------------- | --------------------------------- | -------------------- |
| `DefaultWalrusReadAdapter` + `DefaultWalrusWriteAdapter`          | Trustless (direct fanout to every storage node) | Spotty; depends on your network | 2 (with `addEntryFromBytes`) or 3 (split) | Consumer wallet (WAL + gas) |
| `HttpAggregatorReadAdapter` + `HttpPublisherWriteAdapter`         | Operator-trusted | Reliable        | 1 (`uploadBlob` is a publisher HTTP call, only `addEntry` signs) | Publisher operator (WAL); consumer (Sui gas only) |

**When to pick which:**
- **Default direct-protocol pair**: trustless reads, full control. Best for CLI smokes, server-side dapps, or browser dapps that don't hit CORS gaps. The flow-aware optimization (`addEntryFromBytes`) cuts popups from 3 to 2.
- **HTTP pair**: reliable browser reads (one CORS-friendly endpoint instead of ~30), and a "publisher pays storage" UX where the user signs only the on-chain `addEntry`. Trade trustless reads for operator trust; use `verifyBlobIntegrity` on the read adapter for a trust-but-verify path.

### When direct writes fail: the upload relay

A direct write pushes slivers to every node in the committee at once (95 on mainnet, ~100 on testnet). Networks that cannot sustain that burst fail with `NotEnoughBlobConfirmationsError` or "Unable to connect", **even when the nodes are healthy and far above write quorum**. If uploads fail for you while reads work, this is almost certainly why, and it is not a fault in your config.

`WalrusAdapterConfig` is `@mysten/walrus`'s `WalrusClientConfig`, so you can hand the client an upload relay and let it do the fanout server-side. One connection replaces ~95:

```ts
const writer = DefaultWalrusWriteAdapter.fromConfig(
  {
    network: "mainnet",
    suiClient,
    uploadRelay: {
      host: "https://upload-relay.mainnet.walrus.space",
      sendTip: { max: 10_000_000 },
    },
  },
  signer,
);
```

Three things to know before reaching for it:

- **It costs a tip per upload**, on top of WAL and gas. Mainnet is linear in encoded size (40 MIST/KiB at the time of writing), testnet is a small constant. Query the live figure at `GET /v1/tip-config`.
- **`sendTip.max` must cover it.** Too low and `@mysten/walrus` throws `Tip amount (N) exceeds the maximum allowed tip (M)` before uploading anything.
- **The relay sees your bytes.** Same trust trade as the HTTP aggregator, so encrypt first if that matters.

The smoke scripts take `WALRUS_UPLOAD_RELAY=1` to route through the canonical relay for the selected network, which is the quickest way to tell a network problem apart from a real one.

The HTTP adapters are NOT compatible with `addEntryFromBytes` / `addEncryptedEntryFromBytes`. Those functions require `WalrusFlowCapable` for the 2-popup combined PTB; the publisher-paid path is naturally 1-popup through standard `uploadBlob` + `addEntry`.

```ts
// Default (direct, trustless, 2-3 popups). network is "mainnet" or "testnet";
// Walrus has no localnet.
const reader = DefaultWalrusReadAdapter.fromConfig({ network: "mainnet", suiClient });
const writer = DefaultWalrusWriteAdapter.fromConfig({ network: "mainnet", suiClient }, signer);

// HTTP (operator-trusted, 1 popup for upload+addEntry)
const reader = HttpAggregatorReadAdapter.fromMorseConfig(config, suiClient);
const writer = HttpPublisherWriteAdapter.fromConfig({
  publisherUrl: "https://walrus-testnet-publisher.nami.cloud",
  ownerAddress: account.address,
});
```

The aggregator URL is baked into `morseConfig.walrusEndpoints.aggregator` for both mainnet and testnet (Mysten's canonical service for each). The publisher URL is intentionally not baked in - publishers are operator-specific and consumers pick one explicitly. Note that the publisher in the snippet above is a testnet operator; there is no mainnet equivalent the SDK will pick for you.

`HttpPublisherWriteAdapter` parses Mysten's published publisher binary (camelCase JSON) and the documented OpenAPI schema (snake_case fallback). For non-standard publisher forks that serve a different shape, pass `parseResponse` to `HttpPublisherWriteAdapter.fromConfig({ ..., parseResponse })` — it receives the raw decoded JSON and returns an `UploadBlobResult`, replacing the built-in parser. Throws from the callback propagate verbatim.

## Choosing the right entry path

The SDK ships two ways to publish content. The high-level `addEntryFromBytes` (and its encrypted twin `addEncryptedEntryFromBytes`) is the recommended default; the split form (`uploadBlob` + `addEntry`) is for cases the high-level shape doesn't cover.

| Use                                                  | Function                                            | Wallet popups |
| ---------------------------------------------------- | --------------------------------------------------- | ------------- |
| Publish raw bytes as a new entry (typical case)      | `addEntryFromBytes`                                 | 2             |
| Publish encrypted bytes as a new entry               | `addEncryptedEntryFromBytes`                        | 2             |
| Reuse one blob across many entries (deduplication)   | `uploadBlob` once, then `addEntry` N times          | 2 + N         |
| Decouple upload and add-entry (e.g. draft-then-attach UX) | `uploadBlob` (upload time), `addEntry` (publish time) | 2 + 1         |
| Server pre-uploads, browser only adds entries        | `uploadBlob` (server), `addEntry` (browser)         | 0 server + 1 browser |

**`addEntryFromBytes` requires a `WalrusWriteAdapter` that also implements `WalrusFlowCapable`** (the optimization uses its flow-aware `startBlobUpload` API). The default `DefaultWalrusWriteAdapter` implements both; custom adapters that don't implement the capability are rejected with `TransportError` before any IO and should use the split form.

If `addEntryFromBytes` succeeds in popup 1 (register + upload) but fails in popup 2 (the combined certify + add_entry tx — user rejected, contract aborted, network blip), it throws `UncertifiedBlobError` carrying the `blobObjectId` and `blobId` of the orphaned blob. The blob is on storage nodes and you've paid for it but it's uncertified; storage releases on registration expiry. Surface the error to your user or log the IDs for support.

## Examples

Per-concern, compile-checked illustrative code. Each file is short, focused, and intended to be read alongside the JSDoc on the public exports.

| Concern                               | File                                                                | Covers                                                                                |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Setup                                 | [`examples/setup.ts`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/setup.ts)                          | morseConfig, gRPC client, KeypairAdapter, reader                                      |
| Quick start                           | [`examples/quickstart.ts`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/quickstart.ts)                | End-to-end happy path                                                                 |
| Publication lifecycle                 | [`examples/publication-lifecycle.ts`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/publication-lifecycle.ts) | createPublication, transferOwnership, deletePublication                          |
| Publisher cap roles                   | [`examples/publisher-caps.ts`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/publisher-caps.ts)        | issuePublisherCap, transferPublisherCap, revokePublisherCap, destroyPublisherCap      |
| Collections                           | [`examples/collections.ts`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/collections.ts)              | createCollection (Blob and Quilt modes), deleteCollection                             |
| Entries (revisions, draft → publish)  | [`examples/entries.ts`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/entries.ts)                      | addEntry, appendDraftRevision, publishFromDraft, publishDirect, deleteEntry           |
| Encrypted entries                     | [`examples/encrypted-entries.ts`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/encrypted-entries.ts)  | buildPublisherSealId, encrypt, addEncryptedEntry, appendEncryptedDraftRevision, decrypt |
| Reading                               | [`examples/reading.ts`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/reading.ts)                      | getPublication, getEntry, getRevision, listEntries, scanEntries                       |
| Browser wallet integration            | [`examples/wallet-standard.ts`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/wallet-standard.ts)      | WalletAdapter impl against `@mysten/dapp-kit` hooks (or any wallet-standard signer)   |
| React + dapp-kit + Suiet              | [`examples/wallet-standard-react.md`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/wallet-standard-react.md) | Worked walkthrough: providers, connect button, hook, adapter wiring, Seal SessionKey  |
| Walrus HTTP adapters                  | [`examples/walrus-http-adapters.ts`](https://github.com/arcadiasystems/morse-dcms/blob/main/morse-sdk/examples/walrus-http-adapters.ts) | HttpAggregatorReadAdapter + HttpPublisherWriteAdapter (browser-friendly, operator-paid storage) |

## API reference

The full public surface, grouped by concern. Every export carries a JSDoc on its definition; this table is the index, not the documentation.

### Configuration

| Export | Purpose |
| --- | --- |
| `morseConfig({ network })` | Build a `NetworkConfig` for mainnet or testnet (canonical addresses baked in), or supply override fields for forks / local nodes. |
| `Network` | Const enum-like: `"mainnet" \| "testnet" \| "localnet"`. Mainnet and testnet resolve to canonical deployments; localnet throws `ConfigurationError` unless you pass `packageId` and `registryId`. |
| `DEFAULT_RPC_URLS` | Public Sui fullnode URLs per network. Read-only. |
| `TESTED_SUBSTRATE` | Mysten substrate versions verified end-to-end. Diagnostic constant. |

### Domain ops (write paths)

| Export | Purpose |
| --- | --- |
| `createPublication(adapter, config, args)` | Create + share publication; returns `{ publicationId, ownerCapId, publisherCapId }`. |
| `transferOwnership(adapter, config, args)` | Transfer the OwnerCap to a new address. |
| `deletePublication(reader, adapter, config, args)` | Delete an empty publication; pre-flight checks for collections. |
| `issuePublisherCap` / `revokePublisherCap` / `destroyPublisherCap` / `transferPublisherCap` | PublisherCap lifecycle. Issue + transfer-to-holder is atomic. |
| `createCollection` / `deleteCollection` | Collection lifecycle in blob or quilt mode. |
| `addEntryFromBytes(adapter, config, args)` | **Recommended.** Upload + add entry in 2 wallet popups. |
| `addEncryptedEntryFromBytes(adapter, config, args)` | Encrypt + upload + add encrypted entry in 2 wallet popups. |
| `addEntry` / `addEncryptedEntry` | Lower-level: add entry against a pre-uploaded `blobObjectId`. |
| `appendDraftRevision` / `appendEncryptedDraftRevision` / `publishFromDraft` / `publishDirect` | Revision lifecycle on existing entries. |
| `deleteEntry` | Remove an entry and its revisions. |
| `createRecipientFile(adapter, config, args)` | Register + share a `RecipientFile` for a blob already on Walrus (single PTB). |
| `createEncryptedRecipientFile(adapter, config, args)` | Same, for a blob already Seal-encrypted under a caller-supplied `sealIdPrefix`. |
| `uploadRecipientFileFromBytes(adapter, config, args)` | **Recommended.** Upload bytes + register + share a `RecipientFile` addressed to N recipients in 2 wallet popups. |
| `uploadEncryptedRecipientFileFromBytes(adapter, config, args)` | **Recommended.** Encrypt via Seal + upload + register in 2 wallet popups; returns `{ sealIdPrefix, sealNonce, fileId, ... }` for later decrypt. |
| `addRecipient` / `removeRecipient` | Mutate the file's embedded recipient set (owner-only). |
| `updateRecipientFileMetadata` / `transferRecipientFileOwnership` / `deleteRecipientFile` | RecipientFile lifecycle (owner-only). |

### Reader (RPC-backed)

| Export | Purpose |
| --- | --- |
| `RpcPublicationReader.fromMorseConfig(config, client)` | Construct a publication reader bound to the canonical `originalPackageId` for type filters. |
| `reader.getPublication` / `getEntry` / `getRevision` / `getPublisherCap` | Single-object reads. |
| `reader.listPublicationsOwnedBy` / `listPublisherCapsOwnedBy` / `listEntries` | Paginated lists. |
| `reader.scanEntries` | Async-iterator over every entry in a collection. |
| `RpcRecipientFilesReader.fromMorseConfig(config, client)` | Construct a reader for the `recipient_file` module. |
| `filesReader.getRecipientFile(id)` | Live single-object read (parses embedded `members`, blob refs). Throws `ValidationError` if the id resolves to an object of another Move type. |
| `filesReader.getRecipientFileSealPrefix(id)` | The file's Seal id prefix, or `null`. The only reliable "is this encrypted" signal. Costs an extra round trip, so it is a separate call. |
| `buildRecipientFileEventTypes(originPackageId)` | Fully-qualified event type strings for the `RecipientFile*` events; pass `config.recipientFileEventOriginPackageId`. |
| `reconcileRecipientFilesOwnedBy(events, address, eventTypes)` / `reconcileRecipientFilesAccessibleBy(...)` | Pure event-reconciliation helpers — bring your own indexer, get current file sets back. |

### Adapters

| Export | Purpose |
| --- | --- |
| `KeypairAdapter` | Server / CLI `WalletAdapter` wrapping a raw `Ed25519Keypair`. |
| `WalletStandardSigner.fromAccount(account, callbacks)` | Browser-side `Signer` for `@mysten/walrus` and `@mysten/seal`; wraps wallet-standard wallets without ever holding the user's key. Sync; throws `UnsupportedWalletSchemeError` on non-canonical `account.publicKey` (e.g. Phantom). |
| `WalletStandardSigner.fromAccountAsync(account, callbacks, options?)` | Same as `fromAccount`, with signature-based pubkey recovery for wallets that return a non-canonical `account.publicKey` (Phantom). Pass `options.pubkeyCache` to skip the recovery probe across sessions. One extra wallet popup on first session per address; subsequent sessions are zero-popup when a cache is supplied. |
| `BrowserStoragePubkeyCache({ storage?, prefix? })` | `PubkeyCache` backed by browser `localStorage`. Customizable storage backend (for tests, `sessionStorage`, or polyfills) and key prefix. |
| `DefaultWalrusWriteAdapter.fromConfig(config, signer)` | Walrus uploads (blob + quilt). Implements `WalrusFlowCapable` (the 2-popup optimization). |
| `DefaultWalrusReadAdapter.fromConfig(config)` | Walrus reads (`readBlob`, `readBlobByObjectId`, `readQuiltPatch`, `readBlobRef`). |
| `HttpPublisherWriteAdapter.fromConfig({ publisherUrl, ownerAddress })` | Walrus uploads via a publisher HTTP service (operator pays storage; 1 popup for upload + addEntry). |
| `HttpAggregatorReadAdapter.fromMorseConfig(config, suiClient)` / `.fromConfig({ aggregatorUrl, suiClient })` | Walrus reads via a single CORS-friendly aggregator endpoint instead of fanout to ~30 storage nodes. |
| `DefaultSealAdapter.fromMorseConfig(config, options, suiClient)` | Threshold encryption / decryption. Defaults to the network's canonical key servers: two independent servers on testnet, none on mainnet (throws `ConfigurationError`; pass `serverConfigs`). |
| `MAINNET_SEAL_COMMITTEE` | Mysten's mainnet Seal committee as a ready-made `sealKeyServers` value. Requires the `apiKeyName` / `apiKey` Mysten issues you; not a default. |
| `WalletAdapter` / `WalrusWriteAdapter` / `WalrusReadAdapter` / `SealAdapter` | Interfaces for substituting custom implementations. |
| `WalrusFlowCapable` / `isWalrusFlowCapable` | Optional capability for the 2-popup `addEntryFromBytes` path. |

### Seal identity

| Export | Purpose |
| --- | --- |
| `buildPublisherSealId(publicationId, nonce)` | Build a publisher-policy Seal identity (`pubId(32) \|\| tag(1) \|\| nonce`). |
| `decodePublisherSealId(sealId)` | Inspect a publisher identity. Throws `ValidationError` on tampered tags. |
| `buildRecipientFileSealId(prefix, nonce)` | Build a recipient-file Seal identity (`prefix \|\| tag(3) \|\| nonce`). |
| `decodeRecipientFileSealId(sealId, prefixLength)` | Inspect a recipient-file identity (layout is not self-delimiting; caller supplies `prefixLength`). |
| `randomSealPrefix()` / `randomSealNonce()` | Helpers for the common case: 32 random prefix bytes / 16 random nonce bytes. |
| `RECOMMENDED_SEAL_PREFIX_BYTES` / `RECOMMENDED_SEAL_NONCE_BYTES` | The recommended sizes as constants (32 / 16). |

### Codecs (branded ID constructors)

| Export | Purpose |
| --- | --- |
| `toPackageId` / `toRegistryId` / `toPublicationId` / `toOwnerCapId` / `toPublisherCapId` / `toBlobObjectId` / `toSuiAddress` / `toSuiObjectId` | Validate and normalize Sui object IDs to canonical 64-char hex. |
| `toWalrusBlobId` | Validate Walrus content-addressed blob ID (43-char URL-safe-base64). |
| `toQuiltPatchId` | Validate 37-byte quilt patch ID. |
| `accessPolicyToU8` / `accessPolicyFromU8` / `storageModeToU8` / `storageModeFromU8` | Move enum ↔ TypeScript enum conversion. |
| `encodeQuiltPatchId` / `decodeQuiltPatchId` / `quiltPatchIdToString` / `quiltPatchIdFromString` | Quilt patch ID structural codec (`{quiltBlobId, version, startIndex, endIndex}`). |

### Errors

| Export | Purpose |
| --- | --- |
| `MorseError` | Abstract base. Every SDK throw extends it. |
| `ValidationError` (`field`) | Client-side input rejection. |
| `NotFoundError` (`resource`, `identifier`) | Object missing on-chain or on Walrus. |
| `UnauthorizedError` | Client-side auth check failed. |
| `ContractAbortError` (`module`, `abortCode`, `reason`) | Move VM aborted; `ABORT_CODES` table maps codes to names. |
| `SealError` (`code`) | Seal authorization or decryption failure (`no-access` / `decrypt-failed` / `session-expired` / `rate-limited`). |
| `TransportError` | RPC, network, or response-parsing failure. |
| `ConfigurationError` | SDK config gap (e.g. unsupported network, raw-byte sign on `WalletStandardSigner`). |
| `UncertifiedBlobError` (`blobObjectId`, `blobId`) | `addEntryFromBytes` upload succeeded but second popup failed. |

### Types

`Publication`, `Collection`, `Entry`, `Revision`, `PublisherCap`, `OwnerCap`, `BlobRef`, `AccessPolicy`, `StorageMode`, `SealPolicyTag`, `RecipientFile` / `RecipientFileSummary` / `RecipientFileFull`, branded ID types (`PublicationId`, `RecipientFileId`, `BlobObjectId`, `WalrusBlobId`, `QuiltPatchId`, etc.).

## Conceptual model

```
PublicationRegistry              (one shared object, name-uniqueness index)
  Publication                    (one shared object per publication)
    Collection × N               (inline VecMap; storage mode fixed at create)
      Entry × N                  (dynamic-field table; monotonic u64 ids)
        Revision × N             (append-only vector; never mutated in place)
```

- **Publication**: top-level container with a globally-unique slug. Holds collections inline. Owned via `OwnerCap`; write access delegated via `PublisherCap`.
- **Collection**: named bucket for entries. `storageMode` (`Blob` or `Quilt`) is immutable after creation.
- **Entry**: identified by a stable monotonic `u64`. Carries a `name`, append-only `revisions`, and `draftHead` / `publicHead` pointers.
- **Revision**: immutable. Carries a `BlobRef` (Walrus blob object or quilt patch id), `contentType`, `encrypted` flag, `accessPolicy`, `sealId`, and `author`.

## Adapter pattern

Three abstractions; the SDK ships default impls and accepts substitutions:

- **`WalletAdapter`** signs and submits Sui transactions. Default: `KeypairAdapter`. Browser apps implement against a wallet-standard signer.
- **`WalrusWriteAdapter`** uploads bytes to Walrus, returns the resulting blob's Sui object id. Default: `DefaultWalrusWriteAdapter` wrapping `@mysten/walrus`.
- **`SealAdapter`** encrypts and decrypts under a publisher Seal identity. Default: `DefaultSealAdapter` wrapping `@mysten/seal`.

Reader pattern is parallel: `PublicationReader` is the interface, `RpcPublicationReader` is the gRPC-backed default. An indexer-backed reader could implement the same shape.

Always construct readers and seal adapters via `fromMorseConfig` (e.g. `RpcPublicationReader.fromMorseConfig(config, client)`); the raw constructors take `originalPackageId` directly and passing the wrong value silently empties type-filtered list results.

## Wallet scheme support

`WalletStandardSigner.fromAccount(account, callbacks)` takes a wallet-standard `WalletAccount` and produces a Sui `Signer` for `@mysten/walrus` and `@mysten/seal`. It tries every plausible interpretation of `account.publicKey` (raw bytes and Sui's canonical with-flag encoding) and picks the one whose derived address matches `account.address`.

| Scheme    | Status                        | Verified against                                                            | Notes                                                                                                                                                                                                |
| --------- | ----------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ED25519   | Supported (verified)          | Slush + imported keypair, `@mysten/seal@1.1.3`, `@mysten/walrus@1.1.6`, 2026-05-10 | Accepts raw 32-byte key (Suiet) and Sui canonical `0x00 \|\| 32 raw` (Slush). Most common configuration.                                                                                              |
| Secp256k1 | Supported (decoder)           | -                                                                           | Accepts raw 33-byte key and `0x01 \|\| 33 raw`. End-to-end behavior on Walrus + Seal not yet verified against a wallet that exposes Secp256k1 accounts.                                              |
| Secp256r1 | Supported (decoder)           | -                                                                           | Accepts raw 33-byte key and `0x02 \|\| 33 raw`. Disambiguated from Secp256k1 / Passkey by address derivation.                                                                                        |
| Passkey   | Supported (decoder)           | -                                                                           | Accepts raw 33-byte key and `0x06 \|\| 33 raw`. WebAuthn signing inside the wallet; `Signer` surface unchanged.                                                                                      |
| ZkLogin   | Decoder ships, E2E unverified | -                                                                           | Variable-length `[1 iss-len][iss][32 addressSeed]` identifier (auto-detects modern vs legacy address derivation). Walrus and Seal `SessionKey` flows have not been smoke-tested with zkLogin signatures; fall back to a keypair account if you see errors. |
| MultiSig  | Refused                       | -                                                                           | Variable-length aggregation of multiple keys; signing semantics differ from `Signer` and have not been wired up. Implement a custom `Signer` subclass if you need it.                                |
| Phantom (Sui) | Supported via `fromAccountAsync` | 2026-05-21                                                              | Phantom returns a 59-byte non-canonical blob in `account.publicKey`. `fromAccount` rejects it; `fromAccountAsync` recovers the real Ed25519 key from a probe signature. See subsection below.        |

Refused schemes throw `UnsupportedWalletSchemeError` (a `ConfigurationError` subclass) at construction time. The error carries the raw `publicKeyBytes`, the reported `address`, and an optional `walletName`, so consumer dapps can render a wallet-specific CTA without parsing message strings.

### Wallets with non-canonical `publicKey` (Phantom)

Phantom's Sui adapter returns a 59-byte opaque blob in `account.publicKey` instead of the canonical 32 / 33-byte form mandated by wallet-standard. This is a documented Phantom quirk (see the Sui developer forum thread from August 2025), not an SDK gap.

For Phantom-class wallets, use `WalletStandardSigner.fromAccountAsync` instead of `fromAccount`, and pass a `PubkeyCache` to avoid re-prompting on every page reload:

```ts
import {
  WalletStandardSigner,
  BrowserStoragePubkeyCache,
  UnsupportedWalletSchemeError,
} from "@arcadiasystems/morse-sdk";

try {
  const signer = await WalletStandardSigner.fromAccountAsync(account, callbacks, {
    pubkeyCache: new BrowserStoragePubkeyCache(),
  });
} catch (err) {
  if (err instanceof UnsupportedWalletSchemeError) {
    // Render: "Your wallet uses an unsupported scheme. Try Slush or Suiet."
    // err.code, err.publicKeyBytes, err.address, err.walletName available.
  }
}
```

`fromAccountAsync` tries the sync decoder first (no extra IO for compliant wallets), and on failure recovers the real Ed25519 public key by asking the wallet to sign a domain-separated probe message. Sui's canonical signature is `flag || sig || pk` (97 bytes for Ed25519); the last 32 bytes are the raw key. The recovered key is verified to derive to `account.address` before the signer is constructed.

Without a cache, the probe popup fires every session (every page reload, every component remount). With a `BrowserStoragePubkeyCache`, the popup fires once per address; subsequent sessions read from `localStorage` and skip the probe. The cached pubkey is still verified to derive to `account.address` on every load, so stale entries (wallet switch, planted bytes) heal automatically: the SDK calls `cache.clear?.(address)` and re-probes.

For non-browser contexts (SSR, Node, native), implement the `PubkeyCache` interface against IndexedDB, Redis, or any KV store. Methods may be sync or async.

The probe message is `"morse-sdk:wallet-pubkey-recovery:" + address`, wrapped by Sui's `signPersonalMessage` `"Sui Message:"` prefix, so it cannot collide with a real transaction. Compliant wallets pay no extra cost; they take the sync `fromAccount` path inside `fromAccountAsync` and skip both the probe and the cache.

## Error taxonomy

All errors extend `MorseError`. Narrow by class:

| Class                | Carries                          | Thrown when                                                          |
| -------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `ValidationError`    | `field`                          | Client-side input failed a precondition.                             |
| `NotFoundError`      | `resource`, `identifier`         | Object doesn't exist on-chain.                                       |
| `UnauthorizedError`  | -                                | Client-side auth check failed before submit.                         |
| `ContractAbortError` | `module`, `abortCode`, `reason`  | Move VM aborted (e.g. `ESlugAlreadyExists`).                         |
| `SealError`          | `code` (`no-access` / `decrypt-failed` / `session-expired` / `rate-limited`) | Seal authorization or decryption failed. |
| `TransportError`     | `operation?` (e.g. `sui.getObject`, `walrus.publisher.uploadBlob`, `seal.decrypt`) | RPC, network, or response-parsing failure. |
| `ConfigurationError` | -                                | SDK config gap (e.g. unsupported network).                           |
| `UnsupportedWalletSchemeError` | `code` (`non-canonical-pubkey` / `malformed-zklogin` / `recovery-sig-length` / `recovery-non-ed25519` / `recovery-address-mismatch`), `publicKeyBytes`, `address`, optional `walletName` | `WalletStandardSigner.fromAccount` rejected the account's `publicKey` shape, or the async recovery flow could not extract a key that derives to `account.address`. |
| `UncertifiedBlobError` | `blobObjectId`, `blobId`       | `addEntryFromBytes` upload succeeded but the combined certify+add_entry tx failed; the blob is uploaded but uncertified. |

```ts
try {
  await addEntry(adapter, config, args);
} catch (err) {
  if (err instanceof ContractAbortError && err.reason === "EPublisherCapRevoked") {
    // your cap was revoked - issue a new one
  } else if (err instanceof SealError && err.code === "no-access") {
    // identity rejected by key servers
  } else if (err instanceof NotFoundError && err.resource === "entry") {
    // entry was deleted between read and write
  } else if (err instanceof TransportError) {
    // network blip - retry; err.operation names the failing call (e.g. "sui.getObject")
  } else {
    throw err;
  }
}
```

### `formatUserMessage`: UI-ready translation

For consumer dapps that surface SDK errors in toasts, dialogs, or banners, `formatUserMessage(err)` translates any throw (`MorseError` or otherwise) into a `{ title, description, cause }` triple with domain-neutral copy. Use it as the default branch after your own domain-specific handlers:

```ts
import { formatUserMessage } from "@arcadiasystems/morse-sdk";

try {
  await addEntryFromBytes(adapter, config, args);
} catch (err) {
  if (err instanceof SealError && err.code === "no-access") {
    toast.error("You don't have permission", { description: "Ask the author for access." });
    return;
  }
  const { title, description } = formatUserMessage(err);
  toast.error(title, { description });
  // `cause` is preserved on the formatted object for logging.
}
```

Copy uses the protocol's own terminology ("publication", "entry", "PublisherCap"). For consumer domains (blog → post, gallery → image, docs → article), narrow on the error class first and write your own message; `formatUserMessage` is the fallback for everything else.

## Network configuration

```ts
const config = morseConfig({ network: "mainnet" }); // or "testnet"
// {
//   network, rpcUrl, packageId, originalPackageId,
//   recipientFileEventOriginPackageId, registryId,
//   sealKeyServers: [...],        // canonical allowlist for the network
//   walrusEndpoints: { aggregator }
// }
```

The two networks differ in their Seal allowlist, and the difference is not cosmetic:

- **testnet** pins two independent Mysten key servers, so the default threshold is 2 of 2.
- **mainnet** pins nothing, and `DefaultSealAdapter.fromMorseConfig` throws `ConfigurationError` until you supply servers. There is no free open operator on mainnet: the independent ones are commercial and issue per-consumer API keys, and Mysten's committee aggregator answers `401 No API key found in request` to unauthenticated callers.

  This is a hard failure on purpose. Seal reads key-server public keys from chain but fetches key shares from the operator, so an unusable operator still lets `encrypt` succeed and fails only at `decrypt`. Defaulting to one would let you encrypt, pay to store the ciphertext on Walrus, and discover later that it cannot be read. Once you have credentials, `MAINNET_SEAL_COMMITTEE` is the committee in the right shape:

  ```ts
  const config = morseConfig({
    network: "mainnet",
    sealKeyServers: MAINNET_SEAL_COMMITTEE.map((s) => ({
      ...s,
      apiKeyName: "x-api-key",
      apiKey: process.env.SEAL_API_KEY,
    })),
  });
  ```

Override individual fields for forks or local nodes:

```ts
const config = morseConfig({
  network: "localnet",
  packageId: "0x...",     // required: no canonical localnet deployment
  registryId: "0x...",    // required
  rpcUrl: "http://127.0.0.1:9000",
});
```

`packageId` is the published-at address (used for Move calls). `originalPackageId` is the genesis publish address (used for Sui type filters and Seal package binding). Always thread both through `morseConfig` and let the SDK pick the right one per call site.

## Known limitations

- **Unaudited contracts**. The Move package has not been audited. This is the main reason to be conservative about what you put on mainnet.
- **No encrypted publish path**. The Move contract hardcodes `encrypted=false` on `publish_from_draft` and `publish_direct`. Encrypted content stays as drafts.
- **`Subscription` access policy is reserved**, not enforced.
- **`listEntries` ordering is dynamic-field object-store order**, not chronological. Sort by `entry.id` for insertion order.
- **Walrus flakiness**. `NotEnoughBlobConfirmationsError` from the underlying client is environmental; rerun. The SDK preserves the original error as the `cause` (use `instanceof` for narrowing - Walrus error classes don't set `.name`). Browser consumers may additionally see `NoBlobMetadataReceivedError` on reads from testnet due to CORS gaps on a subset of Walrus storage nodes; `HttpAggregatorReadAdapter` exists to route around that. Mainnet node CORS coverage has not been measured by this project, so browser *fanout* reads there are unproven rather than known-good; the aggregator read path is the one verified on mainnet.
- **Walrus uploads need WAL, not just SUI**. Uploads error with `Insufficient balance of ::wal::WAL` if you skip this. On testnet, get SUI from the [Sui faucet](https://faucet.sui.io/) and swap some for WAL at [stake-wal.wal.app](https://stake-wal.wal.app/?network=testnet). On mainnet there is no faucet: both SUI and WAL have to be acquired, and every upload spends real value.
- **Walrus storage is epoch-funded, not permanent**. Blobs persist for the epochs you pay for and expire afterwards unless renewed, on both networks. Epoch length differs (a testnet epoch is roughly a day; mainnet epochs are much longer), so the same `epochs` argument buys very different durations. Walrus testnet is additionally wiped periodically, so treat testnet payloads as disposable; mainnet blobs are not wiped but still lapse if you let storage expire. The on-chain revision history is immutable either way.
- **gRPC client only**. The reader and adapter interfaces are typed against `Pick<SuiGrpcClient, ...>` from `@mysten/sui/grpc`. `SuiJsonRpcClient` from `@mysten/sui/jsonRpc` has differently-named methods (`getDynamicFields` vs `listDynamicFields`, etc.) and is not yet a drop-in alternative. JSON-RPC fallback is planned; for now, environments that block gRPC need to proxy or use a gRPC-compatible RPC endpoint.

## Smoke scripts

The `scripts/` directory has end-to-end smokes that cost real WAL and SUI. They're the canonical "this works against the live deployment" checks. They default to testnet; set `MORSE_NETWORK=mainnet` to point them at mainnet, which additionally requires `MORSE_ALLOW_MAINNET=1` because every mainnet run spends real value.

| Script                    | Exercises                                          |
| ------------------------- | -------------------------------------------------- |
| `phase-2-publication.ts`  | Publication CRUD                                   |
| `phase-3-cap.ts`          | Cap issue / revoke / destroy                       |
| `phase-4-collection.ts`   | Blob and quilt-mode collection lifecycle           |
| `phase-5-walrus.ts`       | Walrus blob and quilt upload                       |
| `phase-6-blob.ts`         | Entry lifecycle in a Blob collection               |
| `phase-6-quilt.ts`        | Entry lifecycle in a Quilt collection              |
| `phase-7-encrypted.ts`    | Seal encrypt + addEncryptedEntry + decrypt         |
| `phase-6-blob-http.ts`    | HTTP publisher upload + aggregator read; skips when `WALRUS_PUBLISHER_URL` unset |
| `phase-7-encrypted-http.ts` | HTTP variant of phase-7; skips when `WALRUS_PUBLISHER_URL` unset |

Each requires `PRIVATE_KEY` (Bech32 `suiprivkey1...`) on a funded address; phase-5 onward also needs WAL on the same address. Phase-7 picks up Seal key servers from `morseConfig.sealKeyServers` by default - pass `SEAL_KEY_SERVERS` only if you want to override with a custom set.

`WALRUS_UPLOAD_RELAY=1` routes the Walrus uploads through the canonical relay for the selected network instead of the direct fanout (see [When direct writes fail](#when-direct-writes-fail-the-upload-relay)). Set it to an explicit base URL to use a different relay. Phases 5 onward fail on networks that cannot open ~95 simultaneous connections; this is the switch that tells that apart from a real defect.

`MORSE_NETWORK` selects the target network and defaults to `testnet`. Only `mainnet` and `testnet` are accepted, since Walrus has no localnet. Running against mainnet additionally requires `MORSE_ALLOW_MAINNET=1`:

```sh
MORSE_NETWORK=mainnet MORSE_ALLOW_MAINNET=1 bun run scripts/phase-2-publication.ts
```

The second variable is not redundant. These scripts create and delete real publications, collections, entries and Walrus blobs, which on mainnet costs real SUI and WAL. Requiring two variables means an inherited `MORSE_NETWORK` from another shell cannot quietly spend money. Every script derives its Walrus and Sui clients from the same resolved network, so a mainnet Sui client can never pair with a testnet Walrus client.

## Development

```sh
# from the repo root
bun install

# from morse-sdk/
bun run lint
bun run typecheck
bun run test
bun run test:coverage   # per-file coverage report
bun run build
```

`bun test` is the unit test runner; `bun run test:coverage` adds a per-file coverage report. CI gates require all four (lint, typecheck, test, build) to pass; coverage is informational. End-to-end testnet smokes live in `scripts/` (above).

## License

MIT. See [LICENSE](./LICENSE).
