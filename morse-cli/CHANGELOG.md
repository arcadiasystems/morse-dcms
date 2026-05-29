# Changelog

All notable changes to `@arcadiasystems/morse-cli` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - unreleased

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
