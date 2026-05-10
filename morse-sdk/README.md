# morse-sdk

TypeScript SDK for [Morse](../morse-contracts), a decentralized content management system on the Sui blockchain. Wraps the Move contract surface, Walrus storage, and Seal threshold encryption behind a typed adapter pattern.

## Status

Pre-release. Testnet only. The Move contract addresses are baked in via `morseConfig({ network: "testnet" })` and re-pinned on every contract redeploy. Mainnet support arrives once the contracts are frozen.

## Install

```sh
bun add morse-sdk @mysten/sui
# Optional - install only what you use:
bun add @mysten/walrus     # for DefaultWalrusWriteAdapter
bun add @mysten/seal       # for DefaultSealAdapter and encrypted entries
```

`@mysten/sui` is required: the SDK takes types from it (`Transaction`, `Signer`) and you construct the gRPC client and keypairs directly. `@mysten/walrus` and `@mysten/seal` are optional peer dependencies; you only pay the install cost for the surface you actually import.

## Compatibility

morse-sdk is built and tested against specific minor versions of its Mysten substrate. Newer or older versions are not validated and may produce runtime errors. The peer-dependency ranges in `package.json` enforce these bounds — `bun install` will warn if you try to use a different minor.

| morse-sdk | `@mysten/sui` | `@mysten/walrus` | `@mysten/seal` | Sui network | Verified  |
| --------- | ------------- | ---------------- | -------------- | ----------- | --------- |
| 0.1.x     | 2.16.2-2.16.x | 1.1.6-1.1.x      | 1.1.3-1.1.x    | testnet     | 2026-05-10 |

Mysten ships breaking changes inside major version boundaries. When `@mysten/walrus@1.2.0` (or any minor bump on these libraries) is released, morse-sdk needs a coordinated minor bump and re-verification before the new minor is supported. Pin via `bun add morse-sdk@~0.1.0` if you want patch updates without surprise minors.

The verification protocol is documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md): every Mysten dep bump runs the full `scripts/phase-N-*.ts` smoke suite against testnet before the bump lands.

### Runtime requirements

morse-sdk is ESM-only (`"type": "module"` in `package.json`); CommonJS `require` is not supported.

| Runtime | Supported | Notes                                                                                                                                            |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bun     | >= 1.2.0  | Primary development runtime. Enforced via `engines.bun`. Smoke scripts (`bun run scripts/phase-N-*.ts`) require Bun.                              |
| Node    | >= 18.0   | Library code uses ES2022 features (private class fields, `Error.cause`), `TextEncoder` / `crypto.getRandomValues` / `BigInt` (all stable on Node 18+). |
| Browser | Evergreen | Chrome / Edge / Firefox / Safari recent stable. Bundlers (Vite, Webpack, esbuild) handle the rest. No `require`-based polyfills needed.            |

The SDK does not pull in Node-specific APIs (`fs`, `path`, `process`, `crypto` from `node:crypto`); the public surface is portable across both runtimes. A handful of `@mysten/*` substrate libraries reach into Node-shaped APIs internally — consult their documentation for browser polyfill requirements (typically zero with modern bundlers).

## Quick start

Setup once at startup:

```ts
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  KeypairAdapter,
  morseConfig,
  RpcPublicationReader,
} from "morse-sdk";

const config = morseConfig({ network: "testnet" });
const client = new SuiGrpcClient({ network: "testnet", baseUrl: config.rpcUrl });
const adapter = KeypairAdapter.fromSecretKey(privateKey, client);
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
} from "morse-sdk";

const created = await createPublication(adapter, config, {
  name: "My Publication",
  slug: "my-publication",
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

The compile-checked end-to-end version is in [`examples/quickstart.ts`](./examples/quickstart.ts).

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
| Setup                                 | [`examples/setup.ts`](./examples/setup.ts)                          | morseConfig, gRPC client, KeypairAdapter, reader                                      |
| Quick start                           | [`examples/quickstart.ts`](./examples/quickstart.ts)                | End-to-end happy path                                                                 |
| Publication lifecycle                 | [`examples/publication-lifecycle.ts`](./examples/publication-lifecycle.ts) | createPublication, transferOwnership, deletePublication                          |
| Publisher cap roles                   | [`examples/publisher-caps.ts`](./examples/publisher-caps.ts)        | issuePublisherCap, transferPublisherCap, revokePublisherCap, destroyPublisherCap      |
| Collections                           | [`examples/collections.ts`](./examples/collections.ts)              | createCollection (Blob and Quilt modes), deleteCollection                             |
| Entries (revisions, draft → publish)  | [`examples/entries.ts`](./examples/entries.ts)                      | addEntry, appendDraftRevision, publishFromDraft, publishDirect, deleteEntry           |
| Encrypted entries                     | [`examples/encrypted-entries.ts`](./examples/encrypted-entries.ts)  | buildPublisherSealId, encrypt, addEncryptedEntry, appendEncryptedDraftRevision, decrypt |
| Reading                               | [`examples/reading.ts`](./examples/reading.ts)                      | getPublication, getEntry, getRevision, listEntries, scanEntries                       |
| Browser wallet integration            | [`examples/wallet-standard.ts`](./examples/wallet-standard.ts)      | WalletAdapter impl against `@mysten/dapp-kit` hooks (or any wallet-standard signer)   |
| React + dapp-kit + Suiet              | [`examples/wallet-standard-react.md`](./examples/wallet-standard-react.md) | Worked walkthrough: providers, connect button, hook, adapter wiring, Seal SessionKey  |

## API reference

The full public surface, grouped by concern. Every export carries a JSDoc on its definition; this table is the index, not the documentation.

### Configuration

| Export | Purpose |
| --- | --- |
| `morseConfig({ network })` | Build a `NetworkConfig` for testnet (canonical addresses baked in) or supply override fields for forks / local nodes. |
| `Network` | Const enum-like: `"mainnet" \| "testnet" \| "localnet"`. Mainnet currently throws `ConfigurationError` (gates v1.0.0). |
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

### Reader (RPC-backed)

| Export | Purpose |
| --- | --- |
| `RpcPublicationReader.fromMorseConfig(config, client)` | Construct a reader bound to the canonical `originalPackageId` for type filters. |
| `reader.getPublication` / `getEntry` / `getRevision` / `getPublisherCap` | Single-object reads. |
| `reader.listPublicationsOwnedBy` / `listPublisherCapsOwnedBy` / `listEntries` | Paginated lists. |
| `reader.scanEntries` | Async-iterator over every entry in a collection. |

### Adapters

| Export | Purpose |
| --- | --- |
| `KeypairAdapter` | Server / CLI `WalletAdapter` wrapping a raw `Ed25519Keypair`. |
| `WalletStandardSigner.fromAccount(account, callbacks)` | Browser-side `Signer` for `@mysten/walrus` and `@mysten/seal`; wraps wallet-standard wallets without ever holding the user's key. |
| `DefaultWalrusWriteAdapter.fromConfig(config, signer)` | Walrus uploads (blob + quilt). Implements `WalrusFlowCapable` (the 2-popup optimization). |
| `DefaultWalrusReadAdapter.fromConfig(config)` | Walrus reads (`readBlob`, `readBlobByObjectId`, `readQuiltPatch`, `readBlobRef`). |
| `DefaultSealAdapter.fromMorseConfig(config, options, suiClient)` | Threshold encryption / decryption. Defaults canonical testnet key servers. |
| `WalletAdapter` / `WalrusWriteAdapter` / `WalrusReadAdapter` / `SealAdapter` | Interfaces for substituting custom implementations. |
| `WalrusFlowCapable` / `isWalrusFlowCapable` | Optional capability for the 2-popup `addEntryFromBytes` path. |

### Seal identity

| Export | Purpose |
| --- | --- |
| `buildPublisherSealId(publicationId, nonce)` | Build a publisher-policy Seal identity (`pubId(32) \|\| tag(1) \|\| nonce`). |
| `decodePublisherSealId(sealId)` | Inspect an existing identity. Throws `ValidationError` on tampered tags. |

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

`Publication`, `Collection`, `Entry`, `Revision`, `PublisherCap`, `OwnerCap`, `BlobRef`, `AccessPolicy`, `StorageMode`, `SealPolicyTag`, branded ID types (`PublicationId`, `BlobObjectId`, `WalrusBlobId`, `QuiltPatchId`, etc.).

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

Refused schemes throw `ConfigurationError` at construction time. Surface the message to your user as "this wallet account isn't supported yet" rather than letting the page crash inside Walrus or Seal later.

## Error taxonomy

All errors extend `MorseError`. Narrow by class:

| Class                | Carries                          | Thrown when                                                          |
| -------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `ValidationError`    | `field`                          | Client-side input failed a precondition.                             |
| `NotFoundError`      | `resource`, `identifier`         | Object doesn't exist on-chain.                                       |
| `UnauthorizedError`  | -                                | Client-side auth check failed before submit.                         |
| `ContractAbortError` | `module`, `abortCode`, `reason`  | Move VM aborted (e.g. `ESlugAlreadyExists`).                         |
| `SealError`          | `code` (`no-access` / `decrypt-failed` / `session-expired` / `rate-limited`) | Seal authorization or decryption failed. |
| `TransportError`     | -                                | RPC, network, or response-parsing failure.                           |
| `ConfigurationError` | -                                | SDK config gap (e.g. unsupported network).                           |
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
    // network blip - retry
  } else {
    throw err;
  }
}
```

## Network configuration

```ts
const config = morseConfig({ network: "testnet" });
// {
//   network, rpcUrl, packageId, originalPackageId, registryId,
//   sealKeyServers: [{ objectId, weight }, ...]   // canonical testnet allowlist
// }
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

- **Testnet only at v0.x**. Mainnet config lands once the contracts are frozen.
- **No encrypted publish path**. The Move contract hardcodes `encrypted=false` on `publish_from_draft` and `publish_direct`. Encrypted content stays as drafts.
- **`Subscription` access policy is reserved**, not enforced.
- **`listEntries` ordering is dynamic-field object-store order**, not chronological. Sort by `entry.id` for insertion order.
- **Walrus testnet flakiness**. `NotEnoughBlobConfirmationsError` from the underlying client is environmental; rerun. The SDK preserves the original error as the `cause` (use `instanceof` for narrowing — Walrus error classes don't set `.name`). Browser consumers may additionally see `NoBlobMetadataReceivedError` on reads from testnet due to CORS gaps on a subset of Walrus storage nodes; the CLI smoke scripts hit the full node pool and are more reliable for verification.
- **Walrus uploads need WAL, not just SUI**. Fund the address from the [Walrus testnet faucet](https://docs.walrus.site/usage/web-tool.html#testnet-tokens) in addition to the [Sui faucet](https://faucet.sui.io/). Uploads error with `Insufficient balance of ::wal::WAL` if you skip this.
- **gRPC client only at v0.1.0**. The reader and adapter interfaces are typed against `Pick<SuiGrpcClient, ...>` from `@mysten/sui/grpc`. `SuiJsonRpcClient` from `@mysten/sui/jsonRpc` has differently-named methods (`getDynamicFields` vs `listDynamicFields`, etc.) and is not yet a drop-in alternative. JSON-RPC fallback is planned for v0.2.0; for now, environments that block gRPC need to proxy or use a gRPC-compatible RPC endpoint.

## Smoke scripts

The `scripts/` directory has end-to-end testnet smokes that cost real WAL and SUI. They're the canonical "this works against the live deployment" checks:

| Script                    | Exercises                                          |
| ------------------------- | -------------------------------------------------- |
| `phase-2-publication.ts`  | Publication CRUD                                   |
| `phase-3-cap.ts`          | Cap issue / revoke / destroy                       |
| `phase-4-collection.ts`   | Blob and quilt-mode collection lifecycle           |
| `phase-5-walrus.ts`       | Walrus blob and quilt upload                       |
| `phase-6-blob.ts`         | Entry lifecycle in a Blob collection               |
| `phase-6-quilt.ts`        | Entry lifecycle in a Quilt collection              |
| `phase-7-encrypted.ts`    | Seal encrypt + addEncryptedEntry + decrypt         |

Each requires `PRIVATE_KEY` (Bech32 `suiprivkey1...`) on an address with testnet SUI; phase-5 onward also needs WAL on the same address. Phase-7 picks up Seal key servers from `morseConfig.sealKeyServers` (canonical testnet allowlist baked in) by default — pass `SEAL_KEY_SERVERS` only if you want to override with a custom set.

## Development

```sh
# from the repo root
bun install

# from morse-sdk/
bun run lint
bun run typecheck
bun run test
bun run test:coverage   # 265 tests, ~97% line / ~96% function coverage at v0.1.0
bun run build
```

`bun test` is the unit test runner; `bun run test:coverage` adds a per-file coverage report. CI gates require all four (lint, typecheck, test, build) to pass; coverage is informational. End-to-end testnet smokes live in `scripts/` (above).

## License

MIT. See [LICENSE](./LICENSE).
