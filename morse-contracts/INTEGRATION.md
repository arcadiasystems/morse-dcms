# Integrating `allowlist` + `file` modules

> **Legacy surface.** `@arcadiasystems/morse-sdk` stopped wrapping these two
> modules in 0.4.0, which replaced them with `recipient_file` (recipients are
> embedded in the file object, so there is no separate allowlist to administer).
> The modules are still compiled into the published package on both networks,
> but nothing in the SDK or CLI calls them and they receive no smoke coverage.
> This document is kept for anyone integrating against them directly. For
> current work, integrate `recipient_file` instead. The deployment addresses
> below are shared by every module in the package and are the live ones.

Reference for consumers building TypeScript / React adapters against the
`allowlist` and `file` Move modules in this package. Use it if you need to
bypass the SDK or write your own adapter (for example in another language).

## Deployment

Addresses come from [`Published.toml`](./Published.toml), which is the source
of truth; the values below are a convenience copy.

- **Mainnet** (2026-09-09, v1, tx `HmiywHYifmrNLMvY2oT8cP5W9hpQc2wFTJAaaQoM8mLY`):
  - `published-at`: `0x4fc7af5d1e19f96e5fab4e677948214eec35e238b252a106c7d5036dcebdcae2`
  - `original-id`: same (unupgraded publish, so the two coincide until the
    first upgrade)
  - `PublicationRegistry`: `0x8d8b23c7acd7c1b260c793f2c648c5be8eb06db7c107b9f06ca3f39b700868ea`
- **Testnet** (v4):
  - `published-at`: `0x468727724e86b7d305e961aee73ef9d868b4b68478952fc23748ef4ccfcaf4b2`
  - `original-id`: `0x191946c5dc1ea1b978e664d85455e81ef9bdd1d3dbb221fd48cf9008d46a00f0`
  - `PublicationRegistry`: `0xb25e4849d720ad5058c1945a819aa1dc01ff899006e3f0fe7cb9c62668d307e2`

Use `published-at` as the `target` of Move calls. Use `original-id` for
type-filtered queries (e.g., `listOwnedObjects({ type: "<original-id>::file::EncryptedFile" })`);
post-upgrade `packageId` would silently return empty results.

## Object types (string form)

| Object | Type |
|---|---|
| `Allowlist` | `<original-id>::allowlist::Allowlist` |
| `Cap` (allowlist admin) | `<original-id>::allowlist::Cap` |
| `EncryptedFile` | `<original-id>::file::EncryptedFile` |

## Seal identity layout

The allowlist policy uses a 34-byte (or longer) identity:

```
[ allowlist_id (32 bytes) ][ SEAL_POLICY_TAG_ALLOWLIST (1 byte = 0x02) ][ nonce (>=1 byte) ]
```

- `allowlist_id` is the Sui object id of the `Allowlist`, raw bytes (NOT hex-encoded).
- `SEAL_POLICY_TAG_ALLOWLIST` is the constant byte `0x02`, distinguishing this
  policy from `seal_approve_publisher` (which uses `0x01`). Both policies can
  coexist in the same package without identity collisions.
- `nonce` is at least 1 byte; 16 random bytes is the recommended size.

Construct via the SDK helper:

```ts
import { buildAllowlistSealId } from "@arcadiasystems/morse-sdk";

const nonce = crypto.getRandomValues(new Uint8Array(16));
const sealId = buildAllowlistSealId(allowlistId, nonce);
// sealId is a 32+1+16 = 49-byte Uint8Array
```

The same `sealId` is used to encrypt and to decrypt — you cannot recover it
from the ciphertext envelope in a consumer-readable form. Persist it
out-of-band (in the share link, in your dapp's database, or in event
metadata) for later decryption.

## seal_approve PTB

Seal key servers dry-run this PTB against a wallet-signed SessionKey before
releasing decryption shares. Construct as:

```
target:    <published-at>::allowlist::seal_approve
arguments:
  0: vector<u8>       — the sealId bytes (same as the encryption identity)
  1: object(Allowlist) — the allowlist object id
```

In `@mysten/sui/transactions`:

```ts
const tx = new Transaction();
tx.moveCall({
  target: `${packageId}::allowlist::seal_approve`,
  arguments: [
    tx.pure.vector("u8", Array.from(sealId)),
    tx.object(allowlistId),
  ],
});
tx.setSender(sessionKey.getAddress());
const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
```

The SDK's `DefaultSealAdapter.decryptUnderAllowlist(ciphertext, options)`
builds this PTB internally; consumers using the SDK do not need to construct
it by hand.

## Write operations

### create_allowlist + share + transfer_cap (composed in one PTB)

```move
allowlist::new_allowlist(name: String): (Allowlist, Cap)
allowlist::share_allowlist(allowlist: Allowlist)
allowlist::transfer_cap(cap: Cap, recipient: address)
```

The SDK's `createAllowlist` composes all three in one transaction and
returns `{ allowlistId, capId, digest, gasUsedMist }`.

### Member management (Cap-gated)

```move
allowlist::add_member(allowlist: &mut Allowlist, cap: &Cap, member: address)
allowlist::remove_member(allowlist: &mut Allowlist, cap: &Cap, member: address)
allowlist::delete_allowlist(allowlist: Allowlist, cap: Cap)
```

Aborts:
- `EUnauthorized` (0): cap does not match the supplied allowlist.
- `EMemberAlreadyPresent` (1): on duplicate add.
- `EMemberNotPresent` (2): on remove of a non-member.

### Encrypted file creation

```move
file::new_encrypted_file(
  blob_id: vector<u8>,            // Walrus content id, raw bytes (NOT base64)
  blob_object_id: Option<ID>,     // on-chain Walrus Blob object, if known
  name: String,                   // original filename
  content_type: String,           // MIME, e.g. "application/pdf"
  size: u64,                      // plaintext bytes
  allowlist_id: ID,               // the allowlist gating decryption
  clock: &Clock,                  // pass 0x6
  ctx: &mut TxContext,
): EncryptedFile

file::share_file(file: EncryptedFile)  // makes it readable by anyone
```

The SDK's `uploadEncryptedFileFromBytes` composes Seal encryption +
Walrus upload + this call + `share_file` in two wallet popups (register_blob
on the first popup; certify_blob + new_encrypted_file + share_file combined
on the second).

### Public (unencrypted) file

Same shape as `new_encrypted_file` minus `allowlist_id`:

```move
file::new_public_file(blob_id, blob_object_id, name, content_type, size, clock, ctx)
```

### File metadata mutations (owner-only)

```move
file::update_metadata(file: &mut EncryptedFile, name: String, content_type: String, ctx)
file::transfer_ownership(file: &mut EncryptedFile, new_owner: address, ctx)
file::delete_file(file: EncryptedFile, ctx)
```

`transfer_ownership` transfers the METADATA-mutation right only.
Decryption access is governed separately by the allowlist; compose
`add_member` + `remove_member` calls in the same PTB if you want full handover.

## Events (for indexing)

### Allowlist

- `AllowlistCreated { allowlist: ID, name: String }` — on `new_allowlist`.
- `MemberAdded { allowlist: ID, member: address }` — on `add_member`.
- `MemberRemoved { allowlist: ID, member: address }` — on `remove_member`.
- `CapTransferred { allowlist: ID, recipient: address }` — on `transfer_cap`.
- `AllowlistDeleted { allowlist: ID, name: String }` — on `delete_allowlist`.

### File

- `FileCreated { file: ID, owner: address, allowlist_id: Option<ID>, encrypted: bool, name: String, content_type: String, size: u64 }` — on `new_encrypted_file` / `new_public_file`.
- `FileMetadataUpdated { file: ID, name: String, content_type: String }` — on `update_metadata`.
- `FileOwnershipTransferred { file: ID, previous_owner: address, new_owner: address }` — on `transfer_ownership`.
- `FileDeleted { file: ID, name: String }` — on `delete_file`.

## Listing files for an address

`EncryptedFile` is a shared object, so Sui's `listOwnedObjects` cannot find
files by owner. From v0.3.0, the SDK ships pure reconciliation helpers that
turn raw event streams into the current state:

- `reconcileFilesOwnedBy(events, address, eventTypes): EncryptedFileSummary[]`
- `reconcileFilesAccessibleBy(events, address, eventTypes): EncryptedFileSummary[]`

The SDK does NOT ship event fetching. Consumers integrate an indexer of
their choice (Mysten public, self-hosted, third-party, or
`suix_queryEvents` on the legacy JSON-RPC) and pass the events to the
reconcile helpers. See `morse-sdk/FILE-UPLOADER.md` section 9 for the
~15-line consumer recipe.

Event types are constructed via `buildFilesEventTypes(packageId)` where
`packageId` is the type-origin id (the package where the event structs were
first defined). For the current deployment this is the v2 upgrade address
(`0xd1b847666a0b47b553444944c3e64e8db129994c85481cabbe9089a1fa218698`).
Stored in `morseConfig.filesEventOriginPackageId`.

## Reading

The SDK's `RpcFilesReader` exposes:

```ts
getAllowlist(id): Promise<Allowlist>
getEncryptedFile(id): Promise<EncryptedFile>
listAllowlistCapsOwnedBy(address, options?): Promise<AllowlistCapListPage>
```

For file listing by ownership or membership, see "Listing files for an
address" above.

## Seal key-server registration

The allowlist policy is exposed through the same package id as the existing
publisher policy, so no additional Seal key-server registration is needed
beyond what's already in place for `seal_approve_publisher`. The key servers
discover `allowlist::seal_approve` via dry-run automatically.

## See also

The allowlist and encrypted-file smoke scripts this section used to list were
removed with the 0.4.0 SDK rewrite. The closest current equivalents cover
`recipient_file`, not the modules documented here:

- `morse-sdk/scripts/phase-8-recipient-file.ts` - recipient-file lifecycle smoke
- `morse-sdk/scripts/example-recipient-file-alice-bob.ts` - narrative example with two keypairs
