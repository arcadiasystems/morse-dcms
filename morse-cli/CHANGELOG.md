# Changelog

All notable changes to `@arcadiasystems/morse-cli` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-09-09

### Added

- **`--upload-relay <url|auto>`** routes Walrus uploads through a relay instead of the direct fanout, with `MORSE_WALRUS_UPLOAD_RELAY` and a per-profile `uploadRelay` following the usual `flags > env > config > defaults` precedence. `auto` resolves to the canonical Mysten relay for the selected network, and is refused on localnet, which has none.

  A direct upload pushes slivers to every storage node in the committee at once, 95 on mainnet. Networks that cannot sustain that burst fail with `NotEnoughBlobConfirmationsError` even when the nodes are healthy and far above write quorum, and until now the CLI had no way around it while the SDK did: `DefaultWalrusWriteAdapter.fromConfig` already accepted `uploadRelay`, the CLI just never offered a way to set it.

  Opt-in rather than default: the direct path is free and trustless, the relay costs a tip and sees your bytes.
- **`--max-tip <mist>`** and `MORSE_WALRUS_MAX_TIP` cap the relay's per-upload tip, defaulting to 10000000 MIST (0.01 SUI). Mainnet prices the tip linearly in encoded blob size, so an uncapped relay upload has no upper bound on what it charges; over the cap `@mysten/walrus` refuses before spending. A non-integer or negative cap is rejected outright rather than falling back to the default, so a typo cannot silently authorise an unbounded tip.
- `config add` takes `--upload-relay` to persist the choice on a profile. The value is validated at add time the way `--network` already is, so `auto` on a network with no canonical relay is refused immediately rather than producing a profile that only fails the first time someone uploads. `config list` shows it in both the human and `--json` renderings.

### Notes

- The relay setting and its tip cap are carried raw through `resolveSettings` and only resolved on the Walrus write path. `resolveSettings` runs for every command, so parsing them eagerly would let a typo'd `MORSE_WALRUS_MAX_TIP` in a shell profile or CI environment break reads that never upload anything. A malformed cap fails the upload, not `publication get`.

  Verified live: uploads through the relay succeed on both networks and round-trip byte for byte, a too-low `--max-tip` refuses before spending, and a malformed one is rejected at parse time.

## [0.6.1] - 2026-09-09

Picks up `@arcadiasystems/morse-sdk@0.6.0` and fixes a download regression it exposed. Upgrade if you use mainnet at all.

### Fixed

- **`file download` worked on no mainnet file, public or not.** `buildFileDownloadContext` constructed the Seal adapter eagerly, so once SDK 0.6.0 stopped pinning mainnet key servers, every download failed at context build with a Seal error before the file was even looked up. Downloading a public file never touches Seal, so the adapter is now built on first use and memoized, matching the lazy-signer pattern the same context already used. Regression covered in `test/program.test.ts` against the real context builder.
- **Encrypted commands now explain themselves on mainnet.** They previously surfaced the SDK's `ConfigurationError`, whose advice ("pass seal.serverConfigs", "start from MAINNET_SEAL_COMMITTEE") names an API the CLI does not expose: there is no flag or env var for key servers, so on mainnet these commands cannot work at all. `entry add-encrypted`, `entry decrypt`, `file upload --encrypt` / `--recipient`, and file decryption now exit 2 with a message that says that and points at testnet or the SDK.
- **`file upload --public` is not caught by that guard.** It shares the encrypt context but never encrypts, so `EncryptContext.seal` became a lazy factory too. Building the adapter eagerly there would have blocked public mainnet uploads the same way the eager build blocked public downloads. Both the refusal and the exemption are covered in `test/program.test.ts`.
- **`file download` refused every public file, on every network.** The check asked whether the file had recipients, on the assumption that "a public file has no recipients". The Move contract auto-includes the owner on creation, so `members` is non-empty for every file that exists, public or not: a public file and an encrypted one both report exactly one member. The result was that `file upload --public` produced a file the CLI would not download, telling the user their plaintext was "unusable ciphertext" and pointing at `--raw`, which then wrote the correct bytes anyway.

  Encryption is now determined by the Seal id prefix via the new `getRecipientFileSealPrefix` in SDK 0.7.0, which is the only reliable signal. This bug predates the mainnet work and shipped in 0.6.0 and earlier.

  It escaped the tests because the download fixture defaulted to `members: []`, modelling an object the contract cannot produce. The fixture now carries a realistic owner-member, and a regression test covers a public file that has members.
- Dependency moves to `@arcadiasystems/morse-sdk@^0.7.0`. The published 0.6.0 declared `^0.5.0`, which resolves to the SDK release whose mainnet Seal default could produce permanently unreadable ciphertext.

### Known gaps

- `file list` still needs `--indexer-url` on every network; public Sui fullnodes have retired the JSON-RPC event query it walks.
- Encrypted mainnet stays blocked until Seal operator credentials are available and the CLI grows a way to pass them.

## [0.6.0] - 2026-09-09

Mainnet support, consuming `@arcadiasystems/morse-sdk@0.5.0`. The Move contracts
went live on Sui mainnet on 2026-09-09; the CLI rejected `mainnet` outright until
now.

### Added

- **`--network mainnet` works**, as do `MORSE_NETWORK=mainnet` and
  `morse config add <name> --network mainnet`. `coerceNetwork` no longer
  special-cases mainnet, and `localnet` is accepted too (it still fails at
  startup unless you point the SDK at your own package and registry, which is
  `morseConfig`'s error to raise, not the flag parser's).
- **Commands that spend gas now name the network they spent on.** The resolved
  network appears as the first detail line under the result headline, and as a
  `network` field in `--json` output. Applied on the write contexts only, so read
  and list output is byte-for-byte unchanged. Nothing selects mainnet implicitly
  (with no flag, env var, or profile the CLI targets testnet), so this is there
  to make a mainnet spend visible after the fact rather than to gate it.

### Fixed

- Status banner claimed v0.3.0, two releases stale, and said mainnet support was
  pending.
- `--network` help text listed only testnet and localnet, in both the global
  flag (`morse --help`) and `config add --network`, as did the `MORSE_NETWORK`
  row of the README env table.
- Seven README links pointed into `examples/`, which is not in the package
  `files` array, so they 404'd on the npm page. Now absolute GitHub URLs;
  `docs/QUICKSTART.md` stays relative because `docs` does ship.
- Dead Walrus faucet link in `docs/QUICKSTART.md`. `docs.walrus.site` no longer
  resolves; WAL acquisition now points at the working stake-wal.wal.app swap,
  matching the README and morse-sdk.
- Known limitations now record that `file list` requires `--indexer-url`, since
  public Sui fullnodes have retired the JSON-RPC event query it walks. This
  affects testnet as well as mainnet and predates this release.

### Known gaps

- `file list` is unusable without `--indexer-url` on every network, per above.
  Porting the event source off `suix_queryEvents` is tracked separately.
- No mainnet run of the opt-in `bun run test:e2e` lifecycle; it stays pointed at
  testnet, where it costs nothing real.
- The Move contracts remain unaudited.

## [0.5.0] - 2026-06-09

Hardening pass from CLI testing: fail fast before paying for Walrus storage,
clearer errors on doomed operations, and accurate listings.

### Added

- `revision publish-from-draft` now reuses the draft's already-uploaded content
  by default (no re-upload, no extra WAL, and the published bytes match what was
  reviewed). Pass `--file`/`--stdin` only to publish replacement content.
- `entry list` / `entry scan` accept `--drafts-only` to show just entries with a
  pending (unpublished) draft. `entry list`/`entry get` now show a draft marker /
  `pendingDraft` line.
- `file download --raw` writes the still-encrypted bytes when no decrypt input is
  given.

### Changed

- `file download` now refuses to write ciphertext when a file has recipients and
  no `--share`/`--prefix`+`--nonce` is given; pass `--raw` to opt in. Previously
  it warned and wrote the raw bytes.
- `entry add` verifies the collection exists (and is blob-mode) before uploading
  to Walrus, so a missing or quilt collection fails without burning storage.
- `collection delete` checks the collection is empty up front and returns a clear
  error instead of a raw transaction abort.
- `file list` now reconciles metadata-update and recipient events, so renames and
  recipient counts are current without `--hydrate`.
- `collection create --mode quilt` warns that quilt collections cannot yet be
  populated with `entry add`.

### Fixed

- The `revision` commands refuse to append an unencrypted revision to an entry
  that has encrypted revisions, instead of silently producing a mixed-encryption
  entry.

## [0.4.2] - 2026-06-05

### Changed

- Requires `@arcadiasystems/morse-sdk` `^0.4.2`. SDK 0.4.2 fixes a gRPC reader
  bug (`Option<ID>` decoding) that prevented `morse file download` and `morse
  file get` from reading a RecipientFile back. No CLI source changes; the fix is
  internal to `RpcRecipientFilesReader.getRecipientFile`, which the CLI already
  calls.

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
