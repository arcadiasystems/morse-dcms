# morse-cli

Command-line interface for the [Morse](https://github.com/arcadiasystems/morse-dcms)
decentralized CMS on Sui. Create and manage publications, collections, and
content entries from your terminal, signing with a locally encrypted key.
Content is stored on [Walrus](https://walrus.xyz); private entries are encrypted
with [Seal](https://github.com/MystenLabs/seal).

> Status: v0.2.0, targeting Sui testnet. The command surface is stable; mainnet
> support lands when the contracts are frozen.

## Requirements

- [Node.js](https://nodejs.org) >= 18, or [Bun](https://bun.sh) >= 1.2. The
  published CLI runs under either.
- A funded Sui testnet address for gas, and testnet WAL for Walrus storage when
  adding content. Get SUI from the [Sui faucet](https://faucet.sui.io/) and WAL
  from the [Walrus testnet faucet](https://docs.walrus.site/usage/web-tool.html).

## Install

```sh
npm i -g @arcadiasystems/morse-cli   # or: bun add -g, pnpm add -g
morse --help
```

Or run without installing:

```sh
npx @arcadiasystems/morse-cli --help   # or: bunx @arcadiasystems/morse-cli
```

From a clone (development), run the source with Bun:

```sh
bun morse-cli/src/index.ts --help
```

## Quick start

A full, copy-pasteable walkthrough lives in [docs/QUICKSTART.md](./docs/QUICKSTART.md).
The short version:

```sh
morse config add testnet --network testnet    # create a profile (becomes default)
morse account import                           # import a key (prompts for key + password)
morse publication create --name "My Blog" --slug my-blog   # becomes the active publication
morse collection create posts                  # becomes the active collection
morse entry add hello --file post.txt          # no ids needed
```

## Active context

Most commands act on a publication and a collection. Rather than pasting a
64-character object id every time, select an active publication and collection
once; commands then default to them. This mirrors how `kubectl`/`gh` use a
current context.

```sh
morse use my-blog            # set the active publication (slug or id)
morse use my-blog posts      # set both publication and collection
morse status                 # show the active profile, account, publication, collection
morse use --clear            # clear the active publication and collection
```

- `publication create` selects the new publication automatically; `collection
  create` selects the new collection. So the common flow needs no ids at all.
- Override the context per command with `-P, --publication <slug|id>` and
  `-C, --collection <name>`. Flags always win over the active context.
- Slugs are resolved against publications owned by the active account (the
  registry has no slug index). Pass an object id to address any publication.

## Configuration

Settings resolve with the precedence `flags > MORSE_* env > config file >
defaults`. The config file lives under `$XDG_CONFIG_HOME/morse` (default
`~/.config/morse`); encrypted keystores live in `keystores/` beside it.

Manage profiles with `morse config`:

```sh
morse config add testnet --network testnet     # create a profile (first becomes default)
morse config list                               # list profiles, * marks the default
morse config use testnet                        # change the default profile
morse config remove testnet                     # delete a profile
morse config path                               # print the config file path
```

Environment variables (override the config file, overridden by flags):

| Variable | Overrides | Notes |
| --- | --- | --- |
| `MORSE_PROFILE` | `--profile` | Profile to use. |
| `MORSE_NETWORK` | `--network` | `testnet` or `localnet`. |
| `MORSE_RPC_URL` | `--rpc` | Sui RPC URL override. |
| `MORSE_ADDRESS` | (no flag) | Active account address, selecting which keystore to use. |
| `MORSE_PUBLICATION` | `-P, --publication` | Active publication id. |
| `MORSE_COLLECTION` | `-C, --collection` | Active collection name. |
| `MORSE_PRIVATE_KEY` | (no flag) | Raw Bech32 secret key. Highest-priority key source; never persisted. For CI. |
| `MORSE_KEYSTORE_PASSWORD` | (no flag) | Keystore password for non-interactive unlock. For CI. |
| `XDG_CONFIG_HOME` | (no flag) | Base config directory; defaults to `~/.config`. |

## Security model

Private keys are stored in an encrypted keystore (scrypt + AES-256-GCM) and
unlocked by a password. Specifics:

- Keys are never accepted as command-line flags (they would leak via `ps`,
  `/proc/<pid>/cmdline`, and shell history). They come from an interactive hidden
  prompt, the `MORSE_PRIVATE_KEY` env var, or the encrypted keystore.
- Keystore files are written `chmod 600`; group- or world-readable key files are
  refused on read.
- Keys are never printed or logged, including under `--debug`. The sole exception
  is `morse account export`, which deliberately reveals a key: it is
  interactive-only, requires confirmation, and is unavailable in `--json` mode.
- The key-source precedence is `MORSE_PRIVATE_KEY` (raw, ephemeral) > the active
  account's keystore (password-unlocked).

## Command reference

Global options apply to every command and must appear before the subcommand
(e.g. `morse --json publication list`).

| Global option | Purpose |
| --- | --- |
| `--network <testnet\|localnet>` | Network to target (default: testnet). |
| `-p, --profile <name>` | Config profile to use. |
| `--rpc <url>` | Override the Sui RPC URL. |
| `--json` | Machine-readable JSON on stdout. |
| `-q, --quiet` | Suppress progress and informational output. |
| `-y, --yes` | Assume yes for confirmation prompts. |
| `--debug` | Print stack traces on error. |
| `-V, --version` | Print the version. |
| `-h, --help` | Show help for any command. |

Commands that act on a publication/collection take `-P, --publication <slug|id>`
and `-C, --collection <name>`, both defaulting to the active context.

### Context

| Command | Purpose |
| --- | --- |
| `use <publication> [collection]` | Set the active publication (slug or id) and optional collection. Omitting the collection clears it. |
| `use --clear` | Clear the active publication and collection. |
| `status` | Show the active profile, network, account, publication, and collection. |

### config

| Command | Purpose |
| --- | --- |
| `config add <name> --network <net> [--rpc <url>]` | Create or update a profile. |
| `config list` | List profiles; `*` marks the default. |
| `config use <name>` | Set the default profile. |
| `config remove <name>` | Delete a profile. |
| `config path` | Print the config file path. |

### account

| Command | Purpose |
| --- | --- |
| `account import` | Import a key into an encrypted keystore (prompts for key + password). |
| `account list` | List imported accounts; `*` marks the active one. |
| `account show` | Print the active account address. |
| `account use <address>` | Set the active account for the current profile. |
| `account export <address>` | Reveal a decrypted key (interactive-only, dangerous). |

### publication (alias: pub)

| Command | Purpose |
| --- | --- |
| `publication get [publication]` | Fetch a publication (default: active). |
| `publication list [address] [--ids-only]` | List publications owned by an address (default: active account); shows slug, id, and name. `--ids-only` skips the per-row reads. |
| `publication create --name <name> --slug <slug>` | Create a publication and select it. |
| `publication delete [publication] [--owner-cap <id>]` | Delete an empty publication (default: active). |
| `publication transfer-ownership <recipient> [-P <slug\|id>] [--owner-cap <id>]` | Transfer the OwnerCap. |

### collection

| Command | Purpose |
| --- | --- |
| `collection list [-P <slug\|id>]` | List collections. |
| `collection create <name> [--mode blob\|quilt] [-P <slug\|id>]` | Create a collection and select it. |
| `collection delete <name> [-P <slug\|id>] [--publisher-cap <id>]` | Delete an empty collection. |

### entry

| Command | Purpose |
| --- | --- |
| `entry get <entryId> [-P …] [-C …]` | Fetch a single entry's metadata. |
| `entry read <entryId> [revisionIndex] [--out <path>] [--via-aggregator] [-P …] [-C …]` | Fetch a public entry's content to stdout or a file. |
| `entry list [-P …] [-C …]` | List entries (paginated). |
| `entry scan [-P …] [-C …]` | List every entry (auto-paginated). |
| `entry add <name> --file <path> [-P …] [-C …]` | Upload content and add a new entry; prints a viewable link. |
| `entry delete <entryId> [-P …] [-C …]` | Delete an entry. |
| `entry add-encrypted <name> --file <path> [-P …] [-C …]` | Encrypt, upload, and add a new entry. |
| `entry decrypt <entryId> [revisionIndex] [--out <path>] [--via-aggregator] [-P …] [-C …]` | Decrypt an encrypted revision. |

`add`, `add-encrypted`, and the revision commands accept `--file <path>` (or `-`
for stdin), `--stdin`, and `--content-type <type>` (inferred from the file
extension otherwise).

They also accept `--epochs <n>` (default 3): the number of Walrus storage epochs
the uploaded blob is paid to be stored for. More epochs means the content lives
longer before its storage registration expires, and costs more WAL up front.
Blobs are always uploaded as deletable (the contract rejects non-deletable
blobs), so that is not configurable. `--epochs` applies only to these upload
commands; pure on-chain commands (publication, collection, cap) have no epochs.

### revision

| Command | Purpose |
| --- | --- |
| `revision publish-direct <entryId> --file <path> [-P …] [-C …]` | Upload content and append a public revision. |
| `revision append-draft <entryId> --file <path> [-P …] [-C …]` | Upload content and append a draft revision. |
| `revision publish-from-draft <entryId> <draftRevisionId> --file <path> [-P …] [-C …]` | Publish a new revision, referencing a draft. |

### cap

| Command | Purpose |
| --- | --- |
| `cap list [address]` | List PublisherCaps held by an address. |
| `cap issue <holder> [-P <slug\|id>] [--owner-cap <id>]` | Issue a PublisherCap bound to an address. |
| `cap revoke <publisherCapId> [-P <slug\|id>] [--owner-cap <id>]` | Revoke a PublisherCap. |
| `cap destroy <publisherCapId> [-P <slug\|id>]` | Destroy a PublisherCap you hold. |
| `cap transfer <publisherCapId> <recipient>` | Transfer a PublisherCap object. |

OwnerCap and PublisherCap IDs are auto-resolved from the active account when the
`--owner-cap` / `--publisher-cap` override is omitted. Destructive operations
(`delete`, `revoke`, `destroy`, `transfer`) confirm interactively unless `--yes`.

### allowlist

Per-wallet allowlists gate who can decrypt encrypted files. The admin Cap is
auto-resolved from the active account when `--cap` is omitted.

| Command | Purpose |
| --- | --- |
| `allowlist create --name <name>` | Create an allowlist; transfers its admin Cap to you. |
| `allowlist add-member <addr> -a <id> [--cap <id>]` | Add a wallet that may decrypt. |
| `allowlist remove-member <addr> -a <id> [--cap <id>]` | Remove a wallet. |
| `allowlist transfer-cap <recipient> -a <id> [--cap <id>] [-y]` | Hand off admin rights. |
| `allowlist delete -a <id> [--cap <id>] [-y]` | Delete an allowlist (dependent files become undecryptable). |
| `allowlist get <id>` | Show an allowlist's name and members. |
| `allowlist list-caps [address]` | List allowlist admin Caps held by an address. |

### file

| Command | Purpose |
| --- | --- |
| `file upload <path> --name <n> [-a <id>] [--public] [--content-type <m>] [--epochs <n>]` | Upload to Walrus and register; `-a` encrypts, `--public` is world-readable. |
| `file register --blob-id <id> --name <n> --content-type <m> --size <bytes> [-a <id>] [--public] [--blob-object-id <id>]` | Register metadata for a blob already on Walrus. |
| `file download <file> [--out <path>] [--seal-id <hex>] [--via-aggregator]` | Download content; decrypts in place when encrypted. |
| `file get <file>` | Fetch a file's on-chain metadata. |
| `file update <file> --name <n> --content-type <m>` | Update name and MIME (owner only). |
| `file transfer-ownership <file> <newOwner> [-y]` | Transfer the metadata right (not decrypt access). |
| `file delete <file> [-y]` | Delete the metadata record (the Walrus blob expires on its own lease). |

Encrypting a file (`file upload -a <allowlist>`) prints a **seal id**. It is not
recoverable from the ciphertext, so save it: `file download` needs it (via
`--seal-id`) plus allowlist membership to decrypt. Listing "files I can decrypt
as a member" is not supported on-chain (encrypted files are shared objects with
no owner index); track file ids yourself or index the contract events.

## Output and scripting

- Human-readable output goes to stdout; progress, warnings, and prompts go to
  stderr. Redirecting stdout yields only the result.
- `--json` emits a single JSON document on stdout (nothing else). `bigint` values
  (e.g. `gasUsedMist`) are encoded as decimal strings and byte arrays (`sealId`,
  quilt patch ids) as `0x`-hex.
- Color is emitted only to a TTY and honors `NO_COLOR` and `FORCE_COLOR`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Generic error (contract abort, uncategorized) |
| 2 | Usage error (bad or missing flags/arguments, invalid id/slug/address, declined confirmation) |
| 3 | Not found |
| 4 | Auth or permission failure (keystore unlock, unauthorized, no-access) |
| 5 | Network or transport failure |

## Examples

- [docs/QUICKSTART.md](./docs/QUICKSTART.md): a full, copy-pasteable walkthrough.
- Runnable shell recipes in [examples/](./examples/):
  - [`lifecycle.sh`](./examples/lifecycle.sh): create, add an entry, read, revise, tear down.
  - [`content.sh`](./examples/content.sh): upload an image and a post, publish a revision, fetch content back, get a link, remove a collection.
  - [`encrypt-decrypt.sh`](./examples/encrypt-decrypt.sh): encrypt with Seal and decrypt back.
  - [`delegation.sh`](./examples/delegation.sh): issue a PublisherCap to a delegate, then revoke it.
  - [`ci-noninteractive.sh`](./examples/ci-noninteractive.sh): env-var auth, `--yes`, and `--json` parsing.
  - [`files.sh`](./examples/files.sh): allowlist + encrypted file round-trip (create allowlist, add a member, upload, download/decrypt, plus a public file).

## Limitations

- A publication's `name` and `slug` are immutable on-chain (the slug is the
  registry's unique key), so there is no rename command.
- `entry read` serves public content to stdout or a file; encrypted entries are
  retrieved with `entry decrypt`, not `entry read`. A shareable Walrus link is
  printed by `entry add` (the `viewUrl` field), since the content id is known at
  upload time.
- `entry read` and `entry decrypt` default to reading from Walrus storage nodes,
  which verifies the bytes against the on-chain blob id. Pass `--via-aggregator`
  to read through the Walrus aggregator HTTP service instead: more reliable when
  storage nodes are flaky (common on testnet), at the cost of trusting the
  aggregator's bytes (no client-side verification).
- Mainnet is not yet deployed; use `testnet`.

## Publishing

Published to the public npm registry as the scoped package
`@arcadiasystems/morse-cli`. The `bin` entry exposes the `morse` command, so once
published users can:

```sh
bun add -g @arcadiasystems/morse-cli   # or: npm i -g @arcadiasystems/morse-cli
bunx @arcadiasystems/morse-cli --help  # or: npx, run without installing
```

The shipped `bin` is `dist/index.js`, a Node-targeted bundle (`bun run build`)
with a `#!/usr/bin/env node` shebang and external dependencies, so installs run
under Node or Bun. `prepublishOnly` runs typecheck, lint, tests, and the build,
so the published `dist/` is always fresh.

Release steps: bump the version in `package.json`, stamp the CHANGELOG date,
then `npm publish` (the package is `publishConfig.access: public`). `npm publish`
ships `dist`, `docs`, `README.md`, `LICENSE`, and `CHANGELOG.md` (see the `files`
allowlist). Publish the SDK first; the CLI depends on `@arcadiasystems/morse-sdk`.

## Development

| Command | What it does |
| --- | --- |
| `bun run test:unit` | In-process tests only (no subprocesses); ~2s, for a tight edit loop. |
| `bun run test:cli` | Subprocess CLI-smoke tests (`test/cli/`); spawns the real bin. |
| `bun test` | The full hermetic suite (unit + CLI smoke), no network. |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run lint` | Biome check. |
| `bun run coverage` | Run the suite with coverage and enforce the floor. |
| `bun run check` | Typecheck, lint, and the coverage gate (the CI gate). |
| `bun run test:e2e` | Live testnet lifecycle. Opt-in: needs `MORSE_PRIVATE_KEY` (or `.env.testnet`) funded with testnet SUI and WAL. Set `MORSE_E2E_AGGREGATOR=1` to route the read steps through `--via-aggregator`. |

The test layering, coverage policy, and anti-flake rules are described in
`CLAUDE.md`. CI runs `check` and `build` on every push and PR that touches the
package (`.github/workflows/cli-ci.yml`); the live e2e is excluded from CI.

## License

MIT
