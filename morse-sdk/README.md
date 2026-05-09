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
import { addEntry, createCollection, createPublication, StorageMode } from "morse-sdk";

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
// (upload a blob to Walrus first - see examples/quickstart.ts)
const entry = await addEntry(adapter, config, {
  publicationId: created.publicationId,
  publisherCapId: created.publisherCapId,
  collectionName: "blog",
  name: "first-post",
  blobObjectId,
  contentType: "text/plain",
});
const fetched = await reader.getEntry(created.publicationId, "blog", entry.entryId);
```

The compile-checked end-to-end version is in [`examples/quickstart.ts`](./examples/quickstart.ts).

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

`WalletStandardSigner.fromAccount(account, callbacks)` takes a wallet-standard `WalletAccount` and produces a Sui `Signer` for `@mysten/walrus` and `@mysten/seal`. It decodes the signature scheme from `account.publicKey` length and confirms the derivation matches `account.address`.

| Scheme       | Status     | Notes                                                                                  |
| ------------ | ---------- | -------------------------------------------------------------------------------------- |
| ED25519      | Supported  | 32-byte raw key. Most common (Sui Wallet, Suiet, Slush keypair accounts).              |
| Secp256k1    | Supported  | 33-byte raw key. Same `Signer` surface; signing routes through the wallet.             |
| Secp256r1    | Supported  | 33-byte raw key. Disambiguated from Secp256k1 / Passkey by address derivation.         |
| Passkey      | Supported  | 33-byte raw key. WebAuthn signing inside the wallet; `Signer` surface unchanged.       |
| ZkLogin      | Refused    | Variable-length identifier with OAuth-tied signing; not exercised against Walrus/Seal. |
| MultiSig     | Refused    | Multi-key signature aggregation; not exercised against Walrus/Seal.                    |

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
- **Walrus testnet flakiness**. `NotEnoughBlobConfirmationsError` from the underlying client is environmental; rerun. The SDK preserves the original error as the `cause`.
- **Browser wallet adapter not shipped**. Implement `WalletAdapter` against your wallet-standard signer; the interface contract is the only requirement.

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

Each requires `PRIVATE_KEY` (Bech32 `suiprivkey1...`) on an address with testnet SUI; phase-5 onward also needs WAL; phase-7 needs `SEAL_KEY_SERVERS` (consult the Mysten Seal docs for the testnet allowlist).

## Development

```sh
# from the repo root
bun install

# from morse-sdk/
bun run lint
bun run typecheck
bun run test
bun run build
```

## License

MIT. See [LICENSE](./LICENSE).
