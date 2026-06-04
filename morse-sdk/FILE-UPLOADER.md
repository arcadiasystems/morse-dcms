# File uploader guide

Quick reference for uploading, downloading, encrypting, and decrypting files via the morse-sdk files module. Companion to the React component `@arcadiasystems/morse-uploader`.

For the on-chain model, type strings, PTB shapes, and event payloads, see `morse-contracts/INTEGRATION.md`.

For a runnable end-to-end narrative with two keypairs (Alice creates, Bob decrypts), see `scripts/example-files-alice-bob.ts`.

## Setup (shared across all flows)

```ts
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  DefaultSealAdapter,
  DefaultWalrusReadAdapter,
  DefaultWalrusWriteAdapter,
  KeypairAdapter,
  morseConfig,
  RpcFilesReader,
} from "@arcadiasystems/morse-sdk";

const config = morseConfig({ network: "testnet" });
const client = new SuiGrpcClient({ network: "testnet", baseUrl: config.rpcUrl });

// CLI / server: raw keypair adapter.
const keypair = Ed25519Keypair.fromSecretKey(/* ... */);
const adapter = new KeypairAdapter(keypair, client);

// Browser dapps: use WalletStandardSigner.fromAccountAsync (see README "Wallets").
// const adapter = await WalletStandardSigner.fromAccountAsync(account, callbacks);

const walrusWrite = DefaultWalrusWriteAdapter.fromConfig(
  { network: "testnet", suiClient: client },
  keypair, // or the same Signer the WalletStandardSigner produced
);
const walrusRead = DefaultWalrusReadAdapter.fromConfig({
  network: "testnet",
  suiClient: client,
});
const seal = DefaultSealAdapter.fromMorseConfig(config, {}, client);
const filesReader = RpcFilesReader.fromMorseConfig(config, client);
```

## 1. Create an allowlist (one-time per group of files)

```ts
import { createAllowlist, addMember, toSuiAddress } from "@arcadiasystems/morse-sdk";

const { allowlistId, capId } = await createAllowlist(adapter, config, {
  name: "team-docs",
});

// Add wallets that should be able to decrypt
await addMember(adapter, config, {
  allowlistId,
  capId,
  member: toSuiAddress("0xb0b..."),
});
```

Persist `allowlistId` and `capId`. The `capId` is the admin token — whoever holds it can add/remove members and delete the allowlist.

One allowlist can gate many files. Reuse a single allowlist for "team folder" UX, or create one per file for "per-file ACL" UX.

## 2. Encrypt + upload an encrypted file

```ts
import {
  buildAllowlistSealId,
  uploadEncryptedFileFromBytes,
} from "@arcadiasystems/morse-sdk";

// Construct the Seal identity. The nonce must be ≥ 1 byte; 16 random bytes is standard.
const nonce = crypto.getRandomValues(new Uint8Array(16));
const sealId = buildAllowlistSealId(allowlistId, nonce);

const plaintext = new TextEncoder().encode("hello, world");

const upload = await uploadEncryptedFileFromBytes(adapter, config, {
  walrus: walrusWrite,
  seal,
  allowlistId,
  sealId,
  plaintext,
  name: "hello.txt",
  contentType: "text/plain",
  upload: { epochs: 2, deletable: true },
  onProgress: (e) => console.log(`phase: ${e.phase}`),
});

console.log({
  fileId: upload.fileId,           // on-chain EncryptedFile object id
  blobId: upload.blobId,           // Walrus content id
  blobObjectId: upload.blobObjectId, // on-chain Blob object
});
```

**Persist `sealId` out-of-band.** It's not recoverable from the ciphertext envelope in a consumer-readable form. Stash it in your dapp's database, embed it in share links, or emit a custom event that an indexer can pick up. Without `sealId` the decrypt side can't request the right key shares.

Two wallet popups happen during this call:
1. `register_blob` (Walrus storage reservation)
2. `certify_blob + new_encrypted_file + share_file` (combined; the SDK composes them into one PTB)

## 3. Upload an unencrypted (public) file

```ts
import { uploadPublicFileFromBytes } from "@arcadiasystems/morse-sdk";

const upload = await uploadPublicFileFromBytes(adapter, config, {
  walrus: walrusWrite,
  bytes,
  name: "logo.png",
  contentType: "image/png",
  upload: { epochs: 2, deletable: true },
});
```

Same two-popup shape; no Seal involvement; bytes on Walrus are world-readable via the aggregator.

## 4. Read metadata + download bytes

```ts
const file = await filesReader.getEncryptedFile(fileId);
// file.name, file.contentType, file.size, file.encrypted, file.allowlistId,
// file.blobId, file.blobObjectId, file.owner, file.createdAtMs

const ciphertextOrBytes = await walrusRead.readBlob(file.blobId);
```

For public files, `ciphertextOrBytes` IS the plaintext — no decrypt step.

For encrypted files, continue to step 5.

## 5. Decrypt an encrypted file

```ts
import { SessionKey } from "@mysten/seal";

// 5a. Build a SessionKey. Triggers one wallet popup (personal-message signature).
const sessionKey = await SessionKey.create({
  address: myAddress,
  packageId: config.originalPackageId ?? config.packageId,
  ttlMin: 10,
  signer: keypair, // or the wallet-standard signer for browser dapps
  suiClient: client,
});

// 5b. Decrypt. Seal key servers dry-run allowlist::seal_approve internally,
// verifying that myAddress is a member of the allowlist. No popup here.
const plaintext = await seal.decryptUnderAllowlist(ciphertextOrBytes, {
  sealId,              // the same sealId used at upload time
  allowlistId: file.allowlistId!,
  sessionKey,
});

const text = new TextDecoder().decode(plaintext);
```

The `SessionKey` is reusable for `ttlMin` minutes against any file gated by the same allowlist — one popup per session, many decrypts.

## 6. Allowlist member management

```ts
import {
  removeMember,
  transferAllowlistCap,
  deleteAllowlist,
} from "@arcadiasystems/morse-sdk";

// Remove a member
await removeMember(adapter, config, { allowlistId, capId, member: bobAddress });

// Hand off admin rights (e.g., when ownership of a "team docs" group changes)
await transferAllowlistCap(adapter, config, { capId, recipient: newAdmin });

// Delete the allowlist. Any encrypted files referencing it become un-decryptable;
// delete them first or migrate them to a different allowlist.
await deleteAllowlist(adapter, config, { allowlistId, capId });
```

## 7. File metadata mutations (owner only)

```ts
import {
  updateFileMetadata,
  transferFileOwnership,
  deleteFile,
} from "@arcadiasystems/morse-sdk";

// Rename or change MIME type
await updateFileMetadata(adapter, config, {
  fileId,
  name: "tax-return-2026.pdf",
  contentType: "application/pdf",
});

// Transfer the metadata-mutation right. Note: decryption access is governed
// separately by the allowlist; if you want full handover, compose with
// addMember(newOwner) and removeMember(oldOwner) in the same PTB.
await transferFileOwnership(adapter, config, { fileId, newOwner });

// Delete the metadata record. Does NOT delete the Walrus blob; that follows
// the Walrus lease lifecycle (max 53 epochs).
await deleteFile(adapter, config, { fileId });
```

## 8. Listing files owned by an address

```ts
const page = await filesReader.listEncryptedFilesOwnedBy(myAddress);
for (const file of page.results) {
  console.log(file.name, file.contentType, file.size);
}
// Use page.nextCursor for pagination.

const capPage = await filesReader.listAllowlistCapsOwnedBy(myAddress);
for (const cap of capPage.results) {
  console.log("admin of:", cap.allowlistId);
}
```

**Listing "files I can decrypt because I am a member"** is not exposed directly — it requires event-based indexing. See `morse-contracts/INTEGRATION.md` for the event subscription approach.

## 9. Standalone encrypt / decrypt (rarely needed)

If you already have ciphertext in hand and just want to decrypt:

```ts
const { ciphertext } = await seal.encrypt(plaintext, { sealId });

const plaintext = await seal.decryptUnderAllowlist(ciphertext, {
  sealId,
  allowlistId,
  sessionKey,
});
```

If you already have bytes uploaded to Walrus and just want to register metadata (no upload step):

```ts
import {
  createEncryptedFile,
  createPublicFile,
} from "@arcadiasystems/morse-sdk";

await createEncryptedFile(adapter, config, {
  allowlistId,
  blobId,           // existing Walrus content id
  blobObjectId,     // optional; on-chain Blob object id if known
  name: "x.pdf",
  contentType: "application/pdf",
  size: BigInt(byteLength),
});
```

## Error handling

All ops throw a `MorseError` subclass on failure. The most common ones for file flows:

| Class | When |
|---|---|
| `ValidationError` | Empty name, oversized name, malformed ID before any RPC. |
| `ContractAbortError` (`module: "allowlist"` or `"file"`) | Move-level abort. Narrow on `err.reason` for the specific code (`EMemberAlreadyPresent`, `ENoAccess`, `EUnauthorized`, etc). |
| `SealError` | `code: "no-access"` when you're not a member; `code: "decrypt-failed"` for tampered ciphertext or wrong `sealId`; `code: "session-expired"` when SessionKey TTL ran out. |
| `UncertifiedBlobError` | `uploadEncryptedFileFromBytes` succeeded uploading bytes but the combined certify+create_file tx failed. Carries `blobId` and `blobObjectId` for retry / support. |
| `TransportError` | Network or RPC failure. Carries `operation` for telemetry. |

`formatUserMessage(err)` turns any of these into a `{ title, description }` pair suitable for a toast or banner.

## See also

- `morse-contracts/INTEGRATION.md` — on-chain types, PTB shapes, events, Move call signatures
- `scripts/example-files-alice-bob.ts` — runnable narrative with two keypairs
- `scripts/phase-9-encrypted-file.ts` — minimal round-trip smoke
- `README.md` — wallet schemes, Walrus access patterns, error taxonomy
