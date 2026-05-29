# morse-cli

Command-line interface for the Morse decentralized CMS on Sui. A thin, layered
consumer of `@arcadiasystems/morse-sdk`: it parses arguments, resolves a key and
config, calls SDK ops, and renders results. No protocol logic lives here.

This is a public, published package (`@arcadiasystems/morse-cli`, `morse` bin).
Treat the command set, flag shapes, exit codes, output streams, and JSON output
as a stable public contract.

## Runtime

Bun is required at runtime (`#!/usr/bin/env bun`, `engines.bun >= 1.2`). Prefer
Bun-native APIs: `Bun.file`/`Bun.write` over `node:fs`, `Bun.spawn` over
`node:child_process`, `Bun.$` over `execa`. Bun loads `.env` automatically; do
not add `dotenv`.

One deliberate exception: keystore crypto uses Web Crypto / `node:crypto`
(scrypt + AES-256-GCM). The security-critical path stays on standard, audited
primitives, not a Bun-only API.

## Architecture and layering

```
src/
  index.ts        bin entry: build program, parse, top-level error boundary -> exit code
  cli/            program assembly, context wiring, output, errors, exit codes, prompts
  config/         profile config file (XDG), schema, atomic store, precedence resolver
  keystore/       encrypted keystore (crypto, format, unlock, key-source -> adapter)
  commands/       one file per noun: parse + delegate only
  format/         table (human), json (machine), id/address formatting
```

Strict layering, enforced in review:

- `commands/` only parse flags and delegate. No business logic, no direct
  `process.env` reads, no SDK client construction.
- `cli/context.ts` is the single place that builds SDK clients (`SuiGrpcClient`,
  `KeypairAdapter`, `RpcPublicationReader`, Walrus/Seal adapters).
- Secrets never leave `keystore/`. A decrypted key is held only long enough to
  build the adapter, never written, printed, or logged.
- Shared plumbing (output, error rendering, config loading) lives in one place.
  Three similar command handlers beat a one-use framework.

## SDK integration

Canonical wiring (see `morse-sdk/examples/setup.ts`):

```ts
const config = morseConfig({ network });
const client = new SuiGrpcClient({ network, baseUrl: rpcOverride ?? config.rpcUrl });
const adapter = KeypairAdapter.fromSecretKey(secret, client);
const reader = RpcPublicationReader.fromMorseConfig(config, client);
```

Ops take `(adapter, config, args)`; `deletePublication` takes
`(reader, adapter, config, args)`. Validate every ID at the CLI boundary with the
SDK's branded codecs (`toPublicationId`, `toOwnerCapId`, ...), which throw on bad
input. Do not hand-roll ID regexes. Render errors through the SDK's
`formatUserMessage`.

## Output discipline (clig.dev)

- stdout carries the command result and only the result: the human-readable
  output, or a single JSON document under `--json`. Diagnostics, progress,
  warnings, and prompts go to stderr, so redirecting stdout yields a clean result.
- `--json` emits a single JSON document on stdout and nothing else: no prose, no
  color, no progress.
- Color, spinners, and progress write to stderr and are gated on
  `process.stderr.isTTY` (the stream that carries them); never color the stdout
  result. Honor `NO_COLOR` (any non-empty value disables color) and `FORCE_COLOR`.
- Interactive prompts only when `process.stdin.isTTY`. In non-TTY contexts, fail
  with a clear message or accept `--yes`.
- Destructive operations confirm unless `--yes`/`-y`. Confirmations state exactly
  what will happen.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Generic error (`ContractAbortError`, uncategorized) |
| 2 | Usage error: bad flags/args, invalid id/slug/address (`ValidationError`, commander `exitOverride`), declined confirmation |
| 3 | Not found (`NotFoundError`) |
| 4 | Auth/permission: keystore unlock failure, `UnauthorizedError`, revoked cap |
| 5 | Network/transport (`TransportError`) |

The class-to-code mapping lives in `cli/errors.ts`. Never `process.exit(0)` after
a caught error. No silent failures that return `undefined` and exit `0`.

## Security

- Never accept a private key as a flag value (it leaks via `ps`,
  `/proc/<pid>/cmdline`, and shell history). Sources, in precedence order:
  `MORSE_PRIVATE_KEY` env (raw, never persisted) > active profile's encrypted
  keystore (unlocked by hidden prompt or `MORSE_KEYSTORE_PASSWORD`).
- Keystore: scrypt KDF + AES-256-GCM. Files are `chmod 600`; refuse
  world/group-readable key files.
- Never print, log, or include a key or password in output, errors, or `--debug`
  traces. Redact anything secret-shaped.

## Config precedence (12-factor)

`flags > MORSE_* env > config file > SDK defaults`. Config lives under
`$XDG_CONFIG_HOME/morse` (default `~/.config/morse`). `MORSE_*` env names are
documented in `--help` and the README.

## Dependencies

Keep the dependency surface minimal. No `inquirer`, `zod`, `chalk`, or table
libraries unless justified. Hand-roll the hidden password prompt (readline + echo
muting), table rendering, and ANSI helpers. Reuse SDK codecs for ID validation.

## Code style (must-fix in review)

- No em dashes anywhere (code, comments, strings, help text, errors). Use
  periods, colons, commas, or parentheses.
- No nested ternaries. Extract to a helper or use if/else.
- Plain `// Section` comments only; no `// ===`, `// ---`, or `// ***`.
- Comments explain WHY, not WHAT. Default to no comment; let naming carry it.
- Terse JSDoc on public module exports: one-line summary plus non-obvious
  constraints. No marketing prose, no time-stamped claims.
- No skipped-test scaffolding (`describe.skip` / `it.skip`). Write the test or
  omit the file.
- No defensive validation for inputs the type system already guarantees.
  Validate at the boundary (argv, file reads, network responses); trust internal
  callers.

## Testing

Run after every change: `bun tsc --noEmit`, then `bun test`, then `biome check .`.

- Unit-test pure logic: keystore crypto round-trip and wrong-password rejection,
  config precedence and atomic writes, error class-to-exit-code mapping, JSON
  output shape.
- Command-level tests spawn the CLI (`Bun.spawn`) and assert the stdout/stderr
  split and exit code: success, bad flag (2), not found (3), unlock failure (4).
- Mock SDK clients with `Pick<SuiGrpcClient, ...>` interfaces. Concrete mocks use
  `as unknown as Interface` because the picked generic method signatures cannot
  be satisfied structurally by a plain mock.

## Review and commit

- After CLI changes, run the `cli-reviewer` agent on the diff. "review"/"audit"
  routes there.
- Never commit or push. Hand the user a Conventional Commits message and stop.
