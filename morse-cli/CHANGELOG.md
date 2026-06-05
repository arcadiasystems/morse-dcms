# Changelog

All notable changes to `@arcadiasystems/morse-cli` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-06-05

### Changed

- Requires `@arcadiasystems/morse-sdk` `^0.4.1`. SDK 0.4.0 had a broken
  created-object type-origin lookup that failed every testnet RecipientFile
  upload with `UncertifiedBlobError`; 0.4.1 fixes it. No CLI source changes; the
  ops already pass the full `NetworkConfig` (which carries
  `recipientFileEventOriginPackageId`), so the fix flows through unchanged.

## [0.4.0] - 2026-06-04

Ports the file commands to the SDK 0.4.0 `RecipientFile` primitive, which
replaces the per-wallet allowlist plus encrypted-file pair with a single object
that carries its recipient list inline. This is a breaking change to the `morse
file` surface and removes `morse allowlist` entirely.

### Added

- `morse file recipient add|remove|list <file> [address]`: manage a file's
  recipient list directly on the file object (replaces `morse allowlist`).
- Recipients on uploads and registration via repeatable `-r, --recipient <addr>`;
  the sender is always included.
- Encrypted uploads emit a **share string** (`mf1.<fileId>.<prefix>.<nonce>`,
  see `format/share.ts`) bundling everything a recipient needs to decrypt, plus
  the raw `sealIdPrefix` and `sealNonce` (hex) in `--json`.
- `morse file download` accepts `--share <string>`, or `--prefix <hex> --nonce
  <hex>`, to decrypt; the file id becomes an optional positional (the share
  string carries it).
- `morse file register --encrypted --seal-prefix <hex>` / `--public`: register
  on-chain metadata for an existing Walrus blob as a `RecipientFile`.

### Changed

- Depends on `@arcadiasystems/morse-sdk` `^0.4.0`.
- `morse file list` reconciles `RecipientFile` events; `--accessible` now lists
  files you can decrypt as a recipient (recipient-list membership), not allowlist
  membership. The human listing shows a `recipients` count column.
- `morse file get` shows the recipient list instead of an allowlist reference.

### Removed

- `morse allowlist` and all its subcommands. Recipient access now lives on the
  file via `morse file recipient`.
- `file upload -a <allowlist>` and `file download --seal-id <hex>`. Use
  `--encrypt` / `--recipient` on upload and `--share` (or `--prefix`/`--nonce`)
  on download.

## [0.3.0] - 2026-06-04

Event-based file listing, wrapping the SDK 0.3.0 reconcile helpers. Purely
additive; all existing commands are unchanged.

### Added

- `morse file list`: list files owned by an address (default: the active
  account), or, with `--accessible`, files decryptable via allowlist membership.
  `--address <addr>` queries another address, `--hydrate` fetches the full record
  per file (adds `blobId`; one read each), `--limit <n>` caps results, `--json`
  emits the summary array.
- Event fetching via `cli/events.ts`: a paginator over `suix_queryEvents` feeding
  the SDK's pure `reconcileFilesOwnedBy` / `reconcileFilesAccessibleBy` helpers.
  `--indexer-url <url>` overrides the event source (any endpoint that speaks
  `suix_queryEvents`).

### Changed

- Depends on `@arcadiasystems/morse-sdk` `^0.3.0`.

### Notes

- Listing reads `suix_queryEvents`, a deprecated Sui JSON-RPC endpoint Mysten is
  sunsetting; on the public RPC it may degrade over time. Use `--indexer-url` to
  point at your own indexer. Results are best-effort and eventually consistent.
- Summaries omit `blobId`/`blobObjectId` (not in the `FileCreated` event); use
  `--hydrate` to fetch them.

## [0.2.0] - 2026-06-04

Wraps the allowlist + encrypted-file surface from `@arcadiasystems/morse-sdk`
0.2.0. Existing publication / collection / entry / cap commands are unchanged.

### Added

- `morse allowlist` group: `create`, `add-member`, `remove-member`,
  `transfer-cap`, `delete`, `get`, `list-caps`. The admin Cap is auto-resolved
  from the active account when `--cap` is omitted (mirrors OwnerCap/PublisherCap
  resolution). `transfer-cap` and `delete` confirm unless `--yes`.
- `morse file` group: `upload` (encrypt with `--allowlist` or `--public`, upload
  to Walrus, and register; prints a seal id for encrypted files), `register`
  (register metadata for a blob already on Walrus), `download` (fetch content,
  decrypting in place for encrypted files via `--seal-id`), `get`, `update`,
  `transfer-ownership`, `delete`.
- `entry read` / `entry decrypt` / `file download` accept `--via-aggregator` to
  read through the Walrus aggregator HTTP service instead of the storage-node
  protocol (more reliable when nodes are flaky; trades client-side blob
  verification for operator trust).

### Changed

- Depends on `@arcadiasystems/morse-sdk` `^0.2.0` (testnet `packageId` updated to
  the contracts v2 deployment).

### Notes

- A file's seal id is not recoverable from its ciphertext; save the value
  printed by `file upload` to decrypt later.
- Listing files accessible by allowlist membership is not exposed (encrypted
  files are shared objects with no owner index); it needs event indexing.

## [0.1.0] - 2026-05-29

### Added

- Runs under Node (>= 18) or Bun. The published `bin` is a Node-targeted bundle
  (`dist/index.js`, built with `bun run build`); file/stdin IO goes through a
  cross-runtime layer (`cli/io.ts`) so `npm i -g` works without Bun.
- Active context: `morse use <slug|id> [collection]`, `morse use --clear`, and
  `morse status`. Publication and collection commands default to the active
  context and accept `-P, --publication <slug|id>` and `-C, --collection <name>`
  overrides. `publication create` and `collection create` auto-select the new
  object. Slugs resolve against publications owned by the active account.
- `morse entry read <entryId> [revisionIndex]`: fetch a public entry's content
  to stdout or `--out <path>`. `entry add` prints a viewable Walrus aggregator
  link (`viewUrl`) for the uploaded content.
- Initial CLI scaffold: package metadata, build/lint/test tooling, and the
  top-level `morse` command with `--help` and `--version`.
- CLI core: global options (`--network`, `--profile`, `--rpc`, `--json`,
  `--quiet`, `--yes`, `--debug`), stdout/stderr output discipline with
  NO_COLOR/FORCE_COLOR handling, a documented exit-code taxonomy, an error
  boundary that renders SDK errors via `formatUserMessage`, and hidden/confirm
  prompts.
- `morse config` commands (`path`, `list`, `add`, `use`, `remove`) backed by a
  profile config file under `$XDG_CONFIG_HOME/morse` with atomic writes and
  `flags > MORSE_* env > config file > defaults` precedence.
- Encrypted keystore (scrypt + AES-256-GCM) and `morse account` commands
  (`import`, `list`, `show`, `use`, `export`). Keys are unlocked by a hidden
  password prompt or `MORSE_KEYSTORE_PASSWORD`, with `MORSE_PRIVATE_KEY` honored
  for CI. Keystore files are `0600`; group/world-readable files are refused.
  Keys are never accepted as flags and never printed except by the explicit,
  interactive-only `account export`.
- Read commands: `morse publication get/list` and `morse entry get/list/scan`,
  backed by `RpcPublicationReader`. `publication list` shows each publication's
  slug and name (`--ids-only` for the fast single-RPC path). JSON output encodes
  `bigint` as decimal strings and byte arrays (`sealId`, quilt patch ids) as
  `0x` hex.
- Write commands: `morse publication create/delete/transfer-ownership` and
  `morse collection create/list/delete`. OwnerCap and PublisherCap IDs are
  auto-resolved from the active account (override with `--owner-cap` /
  `--publisher-cap`). Destructive operations confirm unless `--yes`.
- Content commands: `morse entry add` (upload a file or stdin to Walrus and add
  it as a new entry) and `morse entry delete`, plus `morse revision
  publish-direct/append-draft/publish-from-draft`. Content type is inferred from
  the file extension when not given; `--epochs` sets Walrus storage duration.
- PublisherCap commands: `morse cap issue/list/revoke/destroy/transfer`.
  Destructive operations confirm unless `--yes`.
- Encrypted content (Seal): `morse entry add-encrypted` (encrypt with Seal,
  upload, add an encrypted entry; prints the generated `sealId`) and `morse
  entry decrypt` (fetch ciphertext, sign a SessionKey with the active account,
  recover plaintext to stdout or `--out`).
- Documentation: full command reference and security model in the README, plus a
  copy-pasteable end-to-end quick-start guide in `docs/QUICKSTART.md`.
