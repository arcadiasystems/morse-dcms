# Contributing to morse-sdk

`morse-sdk` is the TypeScript SDK for Morse, a decentralized CMS on Sui. Issues, pull requests, and questions are welcome.

## Reporting issues

Open an issue on GitHub. Useful information:

- Reproduction: minimal code snippet, the morse-sdk version, the resolved `@mysten/sui` / `@mysten/walrus` / `@mysten/seal` versions, and the Sui network (testnet / custom).
- Expected vs actual behavior, with stack traces on errors. ES2022 `cause` chains are preserved by every `MorseError` subclass — please copy the full chain.
- For Walrus or Seal failures, note whether the error is a typed `MorseError` (SDK contract) or an upstream type leaking through (`NoBlobMetadataReceivedError`, `NoAccessError`, etc.) — the latter sometimes indicates an SDK error-mapping gap worth fixing.

For security-related reports, see [`SECURITY.md`](./SECURITY.md). Don't open public issues for vulnerabilities.

## Development setup

```sh
bun install
bun run typecheck   # tsc --noEmit
bun run lint        # biome check .
bun test            # bun's test runner across src/**/*.test.ts
bun run build       # tsc -p tsconfig.build.json (emits dist/)
```

All four gates must pass on every PR. The repository uses [biome](https://biomejs.dev/) for formatting and lint; `bun run lint:fix` applies the safe autofixes.

## House style

- **Conventional Commits** for commit messages (`feat(sdk):`, `fix(sdk):`, `docs(sdk):`, `chore(sdk):`, `test(sdk):`).
- **Errors** extend `MorseError`. New error subclasses go in `src/errors.ts` with structured discriminator fields (`code`, `reason`, `field`, etc.) — narrow by `instanceof` plus property, not by parsing strings.
- **JSDoc** is terse. One-line summary plus non-obvious constraints; no scene-setting; no time-stamped claims; no marketing prose. Prefer `@throws` callouts over inline narration.
- **Types** are branded for ID values (`PublicationId`, `BlobObjectId`, `WalrusBlobId`, etc.). Construct via the codec functions in `src/codecs.ts`, not via `as` casts.
- **Comments** explain *why* a non-obvious choice was made; don't restate what the code does.
- No nested ternaries, no decorated section comments (`// === Foo ===`), no skipped test scaffolding (`describe.skip` / `it.skip`).

## Tests

- Unit tests live alongside the source as `*.test.ts`. Mocks use `@bun:test`'s `mock(...)` helper. Deterministic test fixtures (fixed-secret keypairs, synthetic addresses ending in `0x...0001`-style padding) — no `Math.random()`, no `crypto.getRandomValues()`.
- Smoke scripts in `scripts/` exercise live testnet end-to-end. They cost real SUI and (from phase-5 onward) WAL. Run them when a change touches the Mysten substrate or could regress on-chain behavior.
- Cause-preservation test in `default-adapter.test.ts` locks in the contract that consumers can `instanceof`-narrow upstream errors through `MorseError.cause`. Keep this passing.

## Bumping the Mysten substrate

The SDK is tested against specific minor versions of `@mysten/sui`, `@mysten/walrus`, and `@mysten/seal`. The supported range lives in the `peerDependencies` block of `package.json` and the [`Compatibility`](./README.md#compatibility) table in the README.

When bumping any `@mysten/*` peer dep:

1. **Bump devDependencies first.** Update `package.json` `devDependencies` to the new exact versions and run `bun install`.
2. **Run all gates.** `bun run typecheck && bun run lint && bun test && bun run build` — all four must pass. New TS portability errors (TS2742) sometimes surface here; resolve before continuing.
3. **Run the testnet smoke suite.** Every script in `scripts/phase-N-*.ts` against a fresh testnet address with SUI + WAL funded:
   - `scripts/phase-2-publication.ts` — Sui-only publication CRUD
   - `scripts/phase-3-cap.ts` — Cap lifecycle
   - `scripts/phase-4-collection.ts` — Collection blob and quilt modes
   - `scripts/phase-5-walrus.ts` — Walrus blob and quilt upload
   - `scripts/phase-6-blob.ts` and `scripts/phase-6-quilt.ts` — Entry lifecycle
   - `scripts/phase-7-encrypted.ts` — Seal encrypt + decrypt round-trip
4. **All smokes must PASS on the new versions.** A failure blocks the bump until either the SDK is patched or the upstream issue is filed and resolved.
5. **Update the supported range.** Tighten `peerDependencies` to `>=newVersion <nextMinor`. Update the `Compatibility` table in the README and the `TESTED_SUBSTRATE` constant in `src/compatibility.ts`. Update the `verifiedOn` date.
6. **Commit per-concern.** Separate the dependency bump commit from any code changes the bump required (e.g. portability fixes).

Don't ship a substrate bump without smoking it. Mysten ships breaking changes inside major version boundaries; the smoke suite is the only gate that catches them.

## Pull request expectations

- One concern per PR. Architectural changes, dep bumps, and feature work are separate PRs.
- All four gates green on every commit (not just the final one — mid-PR rebases should not silently break gates).
- New public exports require JSDoc with `@throws` annotations where applicable. Update the README "Choosing the right entry path" or the error taxonomy table if the new surface affects either.
- Test coverage for new behavior. Mocks for unit tests; smokes for anything that touches the Mysten substrate.
- Conventional Commit subject line; the body explains the *why*, not the *what*.
