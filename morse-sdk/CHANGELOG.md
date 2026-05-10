# Changelog

All notable changes to `morse-sdk` will be documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/TheDivic/morse-dcms/releases/tag/v0.1.0
