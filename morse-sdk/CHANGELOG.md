# Changelog

All notable changes to `morse-sdk` will be documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-04

Per-wallet allowlist + encrypted-file metadata module. Substantial new public surface; minor bump per pre-1.0 convention. **No breaking changes**: existing publication / collection / entry / wallet / Walrus / Seal-publisher-policy surface is byte-identical to 0.1.4.

This release wraps the `allowlist` and `file` Move modules added in the morse-contracts v2 upgrade (deployed at `0xd1b847666a0b47b553444944c3e64e8db129994c85481cabbe9089a1fa218698` on testnet; `originalPackageId` unchanged).

### Added: types

- `AllowlistId`, `AllowlistCapId`, `EncryptedFileId` branded ID types.
- `Allowlist`, `AllowlistCap`, `EncryptedFile` read-side records.
- `SealPolicyTag.Allowlist = 2` (distinct from `Publisher = 1`).

### Added: codecs

- `toAllowlistId`, `toAllowlistCapId`, `toEncryptedFileId` (matching the existing `to*Id` shape: validate hex, normalize to 64-char canonical form).

### Added: error codes

- `AbortModule` union extended with `"allowlist" | "file"`.
- Full `ABORT_CODES.allowlist` (6 codes: `EUnauthorized`, `EMemberAlreadyPresent`, `EMemberNotPresent`, `ESealInvalidId`, `ESealWrongPolicyTag`, `ENoAccess`) and `ABORT_CODES.file` (4 codes: `EUnauthorized`, `EBlobIdEmpty`, `ENameInvalid`, `EContentTypeInvalid`) tables.
- `KeypairAdapter`'s simulation-abort mapper recognizes the new modules and surfaces them as `ContractAbortError` (not `TransportError`).

### Added: Seal identity helpers

- `buildAllowlistSealId(allowlistId, nonce)` / `decodeAllowlistSealId(sealId)`. Identity layout: `[allowlist_id(32) || tag=2 || nonce(>=1)]`. Same shape as the publisher policy with a distinct tag byte, so both policies coexist in one package with zero identity-collision risk.

### Added: ops

Allowlist:
- `createAllowlist(adapter, config, { name }) → { allowlistId, capId, digest, gasUsedMist }` : creates + shares + transfers Cap to sender in one PTB.
- `addMember`, `removeMember`, `transferAllowlistCap`, `deleteAllowlist`.

File:
- `createEncryptedFile`, `createPublicFile`. Register on-chain metadata for a file already on Walrus.
- `updateFileMetadata`, `transferFileOwnership`, `deleteFile`. Owner-only mutations.

High-level flow:
- `uploadEncryptedFileFromBytes(adapter, config, { walrus, seal, allowlistId, sealId, plaintext, name, contentType, upload, ... })` : encrypt + upload + register in 2 wallet popups. Mirrors the `addEncryptedEntryFromBytes` shape.
- `uploadPublicFileFromBytes`. Same flow without Seal encryption.
- `FileUploadProgressCallback` / `FileUploadProgressEvent` for progress reporting (`encrypting`, `uploading`, `submitting`, `complete`).

### Added: reader

- `RpcFilesReader.fromMorseConfig(config, client)`. Separate from `RpcPublicationReader` to keep the existing `PublicationReader` interface untouched.
- `getAllowlist`, `getEncryptedFile`, `listAllowlistCapsOwnedBy`, `listEncryptedFilesOwnedBy`.
- "List files accessible by membership" deferred to a future indexer integration; documented in `INTEGRATION.md` with the event-based approach in the interim.

### Added: Seal decrypt for allowlist policy

- `DefaultSealAdapter.decryptUnderAllowlist(ciphertext, { sealId, allowlistId, sessionKey })` : builds the `allowlist::seal_approve` PTB internally; returns the plaintext.
- `SealDecryptUnderAllowlistOptions` exported type.
- The existing `decrypt(...)` (publisher policy) is unchanged.

### Added: scripts

- `scripts/phase-8-allowlist.ts`. Testnet smoke: create allowlist, add/remove member, reader checks, delete.
- `scripts/phase-9-encrypted-file.ts`. Testnet smoke: encrypt + upload + register + decrypt round-trip.
- `scripts/example-files-alice-bob.ts`. Narrative example with two keypairs (Alice creates, Bob decrypts).

### Changed

- `morseConfig({ network: 'testnet' })`'s `packageId` updated to the v2 published-at (`0xd1b8...8698`); `originalPackageId` unchanged.

### Migration

Consumers upgrading from 0.1.4 do not need to change any existing code. To start using the new file features:

```ts
import {
  createAllowlist,
  addMember,
  buildAllowlistSealId,
  uploadEncryptedFileFromBytes,
} from "@arcadiasystems/morse-sdk";
```

See `INTEGRATION.md` in `morse-contracts/` and `scripts/example-files-alice-bob.ts` for the full flow.

## [0.1.4] - 2026-05-21

Pluggable `PubkeyCache` for `fromAccountAsync` so Phantom users do not re-sign a probe message on every page reload.

### Added

- **`PubkeyCache` interface** with `get`, `set`, optional `clear`. Methods may be sync or async, so the same interface backs browser `localStorage`, IndexedDB, and server-side KV stores. Pass via the new `options.pubkeyCache` arg on `fromAccountAsync`.
- **`BrowserStoragePubkeyCache`**: ready-to-use `PubkeyCache` backed by a DOM `Storage`-like interface (defaults to `globalThis.localStorage`). Customizable `prefix` for namespacing. Throws `ConfigurationError` at construction when `localStorage` is unavailable and no `storage` was injected (SSR / Node without polyfill).
- **`BrowserStorageLike` / `BrowserStoragePubkeyCacheOptions`** exported types for consumers building their own storage adapters or tests.

### Changed

- **`fromAccountAsync(account, callbacks, options?)`**: third parameter added. Cache hits are still verified to derive to `account.address` before the signer is trusted; on mismatch the SDK calls `cache.clear?.(address)` and falls through to a fresh probe, then writes the recovered pubkey back via `cache.set`. Stale entries, planted bytes, and wallet rotation all heal automatically. Compliant wallets (sync `fromAccount` path) skip the cache entirely; `get`/`set` are not called.

### Consumer migration

Before (probe popup on every mount):

```ts
const signer = await WalletStandardSigner.fromAccountAsync(account, callbacks);
```

After (probe popup once per address):

```ts
import { BrowserStoragePubkeyCache } from "@arcadiasystems/morse-sdk";
const signer = await WalletStandardSigner.fromAccountAsync(account, callbacks, {
  pubkeyCache: new BrowserStoragePubkeyCache(),
});
```

### Unchanged

No behavior change for callers who do not pass `pubkeyCache`. No behavior change for compliant wallets. `fromAccount` (sync) is unchanged; the cache only applies to the async recovery path. Error classes, public types, and the rest of the SDK surface are byte-identical to 0.1.3.

## [0.1.3] - 2026-05-21

Phantom (Sui) wallet support, plus a structured error class so consumer dapps can render proper UX for unsupported wallets.

### Added

- **`WalletStandardSigner.fromAccountAsync(account, callbacks)`**: async variant of `fromAccount` that recovers the real Ed25519 public key from a probe signature when `account.publicKey` is non-canonical. Compliant wallets (Slush, Suiet) go through the sync path with no extra IO; non-canonical wallets (Phantom) get one extra wallet popup at session start for the recovery. The probe message is domain-separated (`"morse-sdk:wallet-pubkey-recovery:" + address`) so it cannot collide with a real transaction. The recovered key is verified to derive to `account.address` before the signer is constructed; a wallet bug that signs with a different key is caught and rejected.
- **`UnsupportedWalletSchemeError extends ConfigurationError`** with structured fields `code: UnsupportedWalletSchemeCode`, `publicKeyBytes: Readonly<Uint8Array>`, `address: string`, optional `walletName?: string`. The `code` discriminates the failure mode: `non-canonical-pubkey` (sync decode failed, recovery applicable), `malformed-zklogin` (zkLogin-shaped but not decodable, recovery not applicable), `recovery-sig-length` / `recovery-non-ed25519` / `recovery-address-mismatch` (recovery flow failed). Consumer dapps switch on `code` to render the appropriate CTA without parsing message strings.

### Changed

- **`fromAccount` now throws `UnsupportedWalletSchemeError`** (still a `ConfigurationError` subclass) instead of plain `ConfigurationError` on unrecognized public-key shapes. Existing consumers narrowing on `ConfigurationError` continue to work without modification; consumers who want structured fields opt in via `instanceof UnsupportedWalletSchemeError`. The error message also updates the suggested remediation from "implement a custom Signer" to "retry with WalletStandardSigner.fromAccountAsync".

### Context

Phantom's Sui adapter returns a 59-byte opaque blob in `account.publicKey` instead of the canonical 32 / 33-byte form mandated by wallet-standard. This is a known, undocumented quirk (confirmed in the Sui developer forum; the Sui team's response was "reach out to Phantom"). Earlier versions of `WalletStandardSigner` refused these accounts entirely. The recovery flow added here works because Phantom's `signPersonalMessage` does return Sui's canonical 97-byte `flag || sig || pk` signature blob, so the real public key can be extracted from the last 32 bytes of any signature the wallet produces. We do not trust `account.publicKey` at all on the async path.

### Unchanged

No behavior changes for compliant wallets (Slush, Suiet, keypair-backed). `fromAccount` is still synchronous; `fromAccountAsync` is purely additive. Other error classes, public types, and the rest of the SDK surface are byte-identical to 0.1.2.

## [0.1.2] - 2026-05-21

Additive UI-translation helper plus three bug fixes in the reader's error mapping. Pre-1.0 patch-bump per the project's pragmatic versioning policy; semver-strict consumers can treat as a minor (one new export, one new optional field, one corrected throw class).


### Added

- **`formatUserMessage(err: unknown): FormattedError`**: translates any `MorseError` (or unknown throw) into a `{ title, description, cause }` triple suitable for toast headers + bodies, dialog titles + content, banner messages. Accepts `unknown` so consumers can call it directly in a `catch` block without narrowing first; non-`MorseError` throws fall back to a generic message. The original error is preserved on `cause` for further narrowing or logging.
- **`FormattedError`** interface exported from the public surface.
- **`TransportError.operation?: string`**: optional discriminator naming the failing RPC method, HTTP endpoint, or SDK call (`sui.getObject`, `walrus.publisher.uploadBlob`, `seal.decrypt`, etc.). Lets consumers branch on the failing call without parsing message strings. Populated by every throw site in reader.ts, default + HTTP Walrus adapters, the Seal adapter, and the keypair wallet adapter. Surfaced as a parenthetical tag in `formatUserMessage(...).description` for support traceability.

Per-class translations in `formatUserMessage` cover every error discriminator the SDK throws:

- `ContractAbortError`: per-reason friendly title (`ESlugAlreadyExists` → "Slug already taken", `EPublisherCapRevoked` → "Access revoked", etc.); description from the existing `ABORT_CODES` table with two overrides where the table's description leaked internal constants (`EInvalidStorageMode`, `EInvalidQuiltPatchId`).
- `SealError`: per-code title and description (`no-access` / `decrypt-failed` / `session-expired` / `rate-limited`).
- `UncertifiedBlobError`: includes both `blobId` and `blobObjectId` in the description for support traceability.
- `NotFoundError`: per-`resource` title (publication, collection, entry, revision, publisher-cap, owner-cap, registry, blob); `blob` gets a storage-operator-focused description.
- `ValidationError` / `TransportError` / `ConfigurationError`: use the existing `message` (which is already user-prose). `TransportError` appends `(operation)` when set.
- Unknown `MorseError` subclasses fall back to "SDK error" + `message`.
- Non-`MorseError` throws fall back to "Unexpected error" + `err.message` if Error-shaped.

Copy is intentionally domain-neutral (uses the protocol's own terminology: "publication", "entry", "PublisherCap"). Consumer dapps translating to their domain (blog → post, gallery → image, docs → article) should override per-class in their own catch blocks before falling back to `formatUserMessage` for the rest.

### Changed

- **`engines.node: ">=18.0.0"`** added to `package.json` to match the existing README claim. The library already ran on Node 18+ (ESM-only, ES2022, no Node-specific APIs in the public surface) but the engine field only enforced Bun before. npm and pnpm install examples added to the README so the supported install paths are explicit.

### Fixed

- **`RpcPublicationReader` now throws `NotFoundError` (not `ValidationError`) when the gRPC client returns an object envelope without `.json`.** Affects `getPublication`, `getPublisherCap`, and `listPublicationsOwnedBy`. The previous behavior contradicted the documented `getPublication` contract and conflated "object does not exist (or wrong type, or mid-deletion)" with "response shape is genuinely malformed." `ValidationError` is still raised when `.json` is present but a per-field branch fails its shape check.
- **`RpcPublicationReader` now fails fast with `ValidationError` on malformed IDs**, before any network round-trip. Affects `getPublication`, `getPublisherCap`, `listPublicationsOwnedBy`, `listPublisherCapsOwnedBy`, `getEntry`, `getRevision`, `listEntries`, and `scanEntries`. Previously, a string cast through the branded type (`"abc" as PublicationId`, or any JS-side caller) reached the gRPC client and surfaced as `TransportError`. Method inputs are now re-normalized via the same `to*Id` codecs that brand the type initially; additionally, `entryId` / `revisionId` are validated as non-negative integers.

### Unchanged

No behavior changes on `ValidationError` field-shape branches, `TransportError` thrown from genuine network failures, or any other error class shapes. Error `message` strings are byte-identical for unchanged branches. Existing consumers narrowing with `instanceof` + property checks continue to work without modification; the new `TransportError.operation` is optional.

## [0.1.1] - 2026-05-17

Metadata-only patch. No code, behavior, or API surface change.

- Fixed `package.json` `repository.url` to point at the canonical Arcadia Systems org repository (`github.com/arcadiasystems/morse-dcms`) instead of the personal fork that was published on 0.1.0.
- Added `homepage` (links to the SDK subdirectory README) and `bugs` fields so the npm page links resolve correctly.

## [0.1.0] - 2026-05-10

Initial public release. Testnet only; mainnet support is gated on contract freeze and arrives with v1.0.0.

### Surface

- **Domain ops**: `createPublication`, `createCollection` (blob and quilt modes), `addEntry`, `addEncryptedEntry`, revision lifecycle (append, publish from draft, delete), and cap management (`issuePublisherCap`, `revokePublisherCap`, `destroyPublisherCap`, `transferPublisherCap`).
- **High-level entry flows** (recommended): `addEntryFromBytes` and `addEncryptedEntryFromBytes` cut wallet popups from 3 to 2 by combining `certify_blob` + `add_entry_to_collection` into a single PTB after `register_blob` + off-chain upload. Optional `onProgress` callback emits coarse-grained phase events (`encrypting`, `uploading`, `submitting`, `complete`) for UI spinners.
- **Reader**: `RpcPublicationReader` for paginated, type-filtered queries via gRPC; construct via `RpcPublicationReader.fromMorseConfig(config, client)`.
- **Walrus adapters**: `DefaultWalrusWriteAdapter` (blob and quilt uploads with epoch / deletable knobs, plus the new `startBlobUpload` flow primitive used by the high-level entry flows) and `DefaultWalrusReadAdapter` (symmetric reads — `readBlob`, `readBlobByObjectId`, `readQuiltPatch`, `readBlobRef`).
- **Seal adapter**: `DefaultSealAdapter` for threshold encryption. Canonical testnet key servers are baked into `morseConfig.sealKeyServers`; `fromMorseConfig` defaults `serverConfigs` and `threshold` from there. Custom server sets remain available via the explicit override path.
- **Wallet integration**: `WalletStandardSigner.fromAccount(account, callbacks)` for browser dapps. Accepts both raw and Sui-canonical with-flag public-key encodings, supports Ed25519 / Secp256k1 / Secp256r1 / Passkey via address-match disambiguation, refuses MultiSig, and ships a structural decoder for ZkLogin (E2E unverified — see compatibility table in the README).
- **Error taxonomy**: `MorseError` base with `ValidationError`, `NotFoundError`, `UnauthorizedError`, `TransportError`, `ConfigurationError`, `SealError`, `ContractAbortError`, and `UncertifiedBlobError` (raised by `addEntryFromBytes` when the upload step succeeds but the combined certify+addEntry transaction fails; carries `blobObjectId` and `blobId` for recovery / support). ES2022 `cause` preservation is contract-tested for upstream errors so consumers can narrow with `instanceof` (note: some upstream libraries don't set `.name` on subclasses; always prefer `instanceof` over `.name` for narrowing).

### Verified configurations

- Slush wallet (Mysten reference) + imported Ed25519 keypair + `@mysten/seal@1.1.3` + `@mysten/walrus@1.1.6` + `@mysten/sui@2.16.2` on testnet (2026-05-10).
- CLI smoke scripts (`scripts/phase-2-publication.ts` through `scripts/phase-7-encrypted.ts`) cover the full surface end-to-end against the canonical testnet deployment.

### Known limitations

See `README.md` for the full list. Headlines:

- Testnet only; mainnet config arrives with v1.0.0.
- The Move contract hardcodes `encrypted=false` on `publish_from_draft` / `publish_direct`; encrypted content stays as drafts.
- `Subscription` access policy is reserved, not enforced.
- Walrus testnet writes occasionally flake with `NotEnoughBlobConfirmationsError` (rerun); browser-side reads occasionally hit `NoBlobMetadataReceivedError` due to CORS gaps on a subset of testnet storage nodes (CLI smokes are more reliable).
- Wallet schemes other than Ed25519 ship as decoders with E2E unverified; `WalletStandardSigner.fromAccount` will accept them, but `@mysten/walrus` and `@mysten/seal` round-trip is not yet smoke-tested for those configurations.
- gRPC client only at v0.1.0; the reader and adapter interfaces are typed against `Pick<SuiGrpcClient, ...>`. JSON-RPC fallback is planned for v0.2.0.

[0.2.0]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.2.0
[0.1.4]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.1.4
[0.1.3]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.1.3
[0.1.2]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.1.2
[0.1.1]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.1.1
[0.1.0]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.1.0
