# Changelog

All notable changes to `morse-sdk` will be documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-06-05

### Fixed

- `uploadRecipientFileFromBytes`, `uploadEncryptedRecipientFileFromBytes`, `createRecipientFile`, and `createEncryptedRecipientFile` failed every testnet upload with `UncertifiedBlobError` wrapping `TransportError: Receipt is missing a created object of type 0x4687...::recipient_file::RecipientFile`. Sui stamps a created object's type with the package id where its struct was FIRST defined (the type origin), not the current published-at; for `RecipientFile` that is the v3 upgrade address tracked by `recipientFileEventOriginPackageId`. The lookup now uses that origin and falls back to `packageId` only when no origin is configured (fresh deployments). The object-type analogue of the event-type-origin fix already shipped in 0.4.0. Regression covered by new tests in `ops/recipient-file.test.ts` and `ops/recipient-file-from-bytes.test.ts`.

### Added

- `MorseRecipientFileConfig` type: `MorsePackageConfig + recipientFileEventOriginPackageId`. The recipient-file ops now accept this widened shape; passing a plain `morseConfig({ network })` continues to work because `NetworkConfig` is a superset.

## [0.4.0] - 2026-06-04

Replaces the per-wallet `Allowlist` + `EncryptedFile` pair with a single `RecipientFile` primitive that carries its recipient set directly on the file. Target UX: 2 wallet popups for an encrypted upload to N recipients (was N+3). The SDK exposes the new surface only; the legacy `allowlist` and `file` modules remain in the contract bytecode for backward compat with 0.2 / 0.3 clients but no current SDK code paths reach them.

Paired with the morse-contracts v4 upgrade (testnet `published-at`: `0x468727724e86b7d305e961aee73ef9d868b4b68478952fc23748ef4ccfcaf4b2`).

### Breaking changes (pre-1.0)

- Removed types: `Allowlist`, `AllowlistCap`, `AllowlistId`, `AllowlistCapId`, `EncryptedFile`, `EncryptedFileFull`, `EncryptedFileId`, `EncryptedFileSummary`, `EncryptedFileSummaryOrFull`.
- Removed enum constant: `SealPolicyTag.Allowlist` (was `= 2`). Consumers switching on the numeric value should now see only `Publisher = 1` and `RecipientFile = 3`.
- Removed codecs: `toAllowlistId`, `toAllowlistCapId`, `toEncryptedFileId`.
- Removed ops: `createAllowlist`, `deleteAllowlist`, `addMember`, `removeMember`, `transferAllowlistCap`, `createPublicFile`, `createEncryptedFile`, `deleteFile`, `transferFileOwnership`, `updateFileMetadata`, `uploadPublicFileFromBytes`, `uploadEncryptedFileFromBytes`.
- Removed reader: `RpcFilesReader`, `buildFilesEventTypes`, `reconcileFilesOwnedBy`, `reconcileFilesAccessibleBy`.
- Removed seal: `buildAllowlistSealId`, `decodeAllowlistSealId`, `SealAdapter.decryptUnderAllowlist`.
- Renamed config field: `filesEventOriginPackageId` -> `recipientFileEventOriginPackageId`.
- Renamed abort module: `AbortModule "allowlist" | "file"` -> `"recipient_file"`. `NotFoundResource "allowlist" | "encrypted-file"` -> `"recipient-file"`.

### Added: types

- `RecipientFileId` branded ID.
- `RecipientFile`, `RecipientFileSummary` (event-derived), `RecipientFileFull`, `RecipientFileSummaryOrFull`. The `members` array is embedded; no separate allowlist object.
- `SealPolicyTag.RecipientFile = 3` (publisher=1, recipient_file=3; tag 2 is legacy allowlist, not used by the SDK).

### Added: codecs

- `toRecipientFileId`.

### Added: errors

- `AbortModule = "publication" | "collection" | "entry" | "recipient_file"`. `ABORT_CODES.recipient_file` covers codes 0-10. Code 4 = `ERecipientAlreadyPresent`, 5 = `ERecipientNotPresent`, 9 = `ESealPrefixEmpty` (caller-supplied prefix was empty), 10 = `ESealPrefixMissing` (file was created via the legacy `new_recipient_file` path and has no attached prefix to validate against).

### Added: ops

- `createRecipientFile(adapter, config, args)` - single PTB: `new_recipient_file + share_recipient_file`.
- `createEncryptedRecipientFile(adapter, config, args)` - same shape but takes `sealIdPrefix` and calls `new_recipient_file_with_seal_prefix`. Assumes the blob is already Seal-encrypted under `[sealIdPrefix || tag(=3) || nonce]`.
- `addRecipient`, `removeRecipient`, `transferRecipientFileOwnership`, `updateRecipientFileMetadata`, `deleteRecipientFile` - single-Move-call wrappers.
- `uploadRecipientFileFromBytes(adapter, config, { walrus, bytes, recipients, name, contentType, upload })` - **2 popups**: Walrus `register_blob`, then a combined `certify_blob + new_recipient_file + share` PTB.
- `uploadEncryptedRecipientFileFromBytes(adapter, config, { walrus, seal, plaintext, recipients, name, contentType, upload })` - **2 popups** for encrypted uploads. Picks a random seal prefix, encrypts under `[prefix || tag(=3) || nonce]`, uploads ciphertext, then `certify_blob + new_recipient_file_with_seal_prefix + share` in one PTB. Returns `{ sealIdPrefix, sealNonce, fileId, blobId, blobObjectId, ... }` so consumers can rebuild the seal identity for decrypt.

### Added: read layer

- `RpcRecipientFilesReader.getRecipientFile(id)` - live object read; parses `members` from `VecSet<address>`, `blob_id` from either base64 string or u8-array Sui JSON encoding, and `blob_object_id` from `Option<ID>`.
- `buildRecipientFileEventTypes(originPackageId)` - returns fully-qualified event type strings for `RecipientFileCreated`, `RecipientFileDeleted`, `RecipientFileMetadataUpdated`, `RecipientFileOwnershipTransferred`, `RecipientFileSealPrefixAttached`, `RecipientAdded`, `RecipientRemoved`. Pass `config.recipientFileEventOriginPackageId`.
- `reconcileRecipientFilesOwnedBy(events, address, eventTypes): RecipientFileSummary[]`.
- `reconcileRecipientFilesAccessibleBy(events, address, eventTypes): RecipientFileSummary[]`.

### Added: seal

- `buildRecipientFileSealId(prefix, nonce): SealId`. Layout `[prefix(>=1) || tag(=3) || nonce(>=1)]`. No longer derives from a file id (the v3 contract required this; v4's caller-supplied prefix removes the chicken-and-egg).
- `decodeRecipientFileSealId(id, prefixLength)`. Caller supplies `prefixLength` because the layout is not self-delimiting.
- `randomSealPrefix()` returns 32 random bytes; `randomSealNonce()` returns 16. Helpers for the common case.
- `RECOMMENDED_SEAL_PREFIX_BYTES = 32`, `RECOMMENDED_SEAL_NONCE_BYTES = 16`.
- `SealAdapter.decryptUnderRecipientFile(ciphertext, { sessionKey, sealId, fileId })`. Builds a `recipient_file::seal_approve_with_prefix` PTB; the on-chain dynamic-field check is the authoritative validator (no client-side prefix decode).

### Added: smoke + example scripts

- `scripts/phase-8-recipient-file.ts` - end-to-end on testnet: public upload, encrypted upload, owner decrypt, delete both.
- `scripts/example-recipient-file-alice-bob.ts` - two keypairs; Alice uploads encrypted RecipientFile addressed to Bob, Bob decrypts.

### Migration from 0.3.0

The new surface is a clean replacement for the allowlist + file pair:

| Before                                                    | After                                                  |
| --------------------------------------------------------- | ------------------------------------------------------ |
| `createAllowlist` + N `addMember` calls + `createEncryptedFile` | `createEncryptedRecipientFile` (or upload variant)     |
| `RpcFilesReader.getAllowlist` / `getEncryptedFile`        | `RpcRecipientFilesReader.getRecipientFile`             |
| `buildAllowlistSealId(allowlistId, nonce)`                | `buildRecipientFileSealId(prefix, nonce)` + bind prefix on file creation |
| `seal.decryptUnderAllowlist({ allowlistId, sealId, ... })`| `seal.decryptUnderRecipientFile({ fileId, sealId, ... })` |
| Reconcile against `MemberAdded`/`AllowlistDeleted`        | Reconcile against `RecipientAdded`/`RecipientFileDeleted` |

No backward-compat shim is provided because pre-1.0 and the legacy modules are deployed but unused by any morse-sdk consumer.

### Config

- `testnet.packageId` updated to v4: `0x468727724e86b7d305e961aee73ef9d868b4b68478952fc23748ef4ccfcaf4b2`.
- `recipientFileEventOriginPackageId` pinned to v3 (the upgrade where `recipient_file` was introduced); will only move on future upgrades that redefine the `recipient_file` module.

## [0.3.0] - 2026-06-04

Event-based file listing helpers, deliberately scoped to NOT include event fetching. Consumers integrate the indexer of their choice (Mysten public, self-hosted, third-party); the SDK ships the parsing + reconciliation logic. All additive, no breaking changes.

### Added: types

- `EncryptedFileSummary` discriminated-union variant (`kind: "summary"`) with event-derivable fields: `id`, `owner`, `name`, `contentType`, `size`, `encrypted`, `allowlistId`, `createdAtMs` (from event envelope `timestampMs`, not the on-chain field).
- `EncryptedFileFull` (`kind: "full"`) wraps the existing `EncryptedFile` for hydrated results.
- `EncryptedFileSummaryOrFull` union returned by the reconcile helpers.

### Added: config

- `NetworkConfig.filesEventOriginPackageId: PackageId` (optional). Type-origin package id for `file::*` and `allowlist::*` event structs. Distinct from `packageId` (which moves on every upgrade) and `originalPackageId` (genesis publication-modules root). Default for testnet baked in (currently equal to `packageId`; will diverge if a future upgrade adds new modules without redefining file/allowlist).

### Added: event type constants

- `buildFilesEventTypes(packageId): FilesEventTypes`. Returns fully-qualified event type strings for `FileCreated`, `FileDeleted`, `FileMetadataUpdated`, `FileOwnershipTransferred`, `AllowlistCreated`, `AllowlistDeleted`, `MemberAdded`, `MemberRemoved`, `CapTransferred`. Pass `config.filesEventOriginPackageId`.

### Added: pure reconcile helpers

- `reconcileFilesOwnedBy(events, address, eventTypes): EncryptedFileSummary[]`. Consumes `FileCreated`, `FileOwnershipTransferred`, `FileDeleted`; returns the current set of files owned by `address`. Order-independent (sorts by `timestampMs` internally). Newest-first.
- `reconcileFilesAccessibleBy(events, address, eventTypes): EncryptedFileSummary[]`. Consumes `MemberAdded`, `MemberRemoved`, `AllowlistDeleted`, `FileCreated`, `FileDeleted`; returns files where `address` is currently a member of the gating allowlist. Excludes public files, deleted files, and files referencing a deleted allowlist.

Both helpers are pure: no I/O, no client, no dependencies. Caller fetches events via their indexer; helpers parse + reconcile.

### Architectural note

The SDK does NOT ship event fetching. Sui v2 gRPC has no historical event query, and Mysten is sunsetting `suix_queryEvents` on the JSON-RPC side. Coupling morse-sdk to a deprecated endpoint or a single indexer service was rejected. Both pushed platform risk into the SDK that consumers couldn't control. The reconcile helpers + event-type constants encode the morse-contract-specific knowledge; the consumer owns the indexer integration. See `FILE-UPLOADER.md` section 9 for the ~15-line consumer recipe.

### Added: docs

- `FILE-UPLOADER.md` new section "9. Listing files via your indexer" with the consumer-side glue example.
- `morse-contracts/INTEGRATION.md` updated to note the helpers are now available.

### Migration from 0.2.0

No code changes required for existing consumers. New file-listing UX wires through the new helpers + a consumer-chosen indexer client.

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

[0.3.0]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.3.0
[0.2.0]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.2.0
[0.1.4]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.1.4
[0.1.3]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.1.3
[0.1.2]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.1.2
[0.1.1]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.1.1
[0.1.0]: https://github.com/arcadiasystems/morse-dcms/releases/tag/v0.1.0
