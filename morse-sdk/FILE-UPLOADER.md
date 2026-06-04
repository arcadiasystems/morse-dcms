# File uploader guide

End-to-end reference for uploading, downloading, encrypting, and decrypting files via the morse-sdk `recipient_file` module. The primitive is `RecipientFile`: a shared Sui object that carries its recipient set inline. Each file is independent; there is no separate allowlist object.

For the on-chain model, type strings, PTB shapes, and event payloads, see `morse-contracts/INTEGRATION.md`.

For a runnable end-to-end narrative with two keypairs (Alice uploads encrypted, Bob decrypts), see `scripts/example-recipient-file-alice-bob.ts`.

## At a glance

| Goal | Function | Popups |
|------|----------|--------|
| Upload a public file with a list of viewers | `uploadRecipientFileFromBytes` | 2 |
| Upload an encrypted file with a list of recipients | `uploadEncryptedRecipientFileFromBytes` | 2 |
| Add or remove a recipient on an existing file | `addRecipient` / `removeRecipient` | 1 each |
| Read a file's metadata + recipient list | `RpcRecipientFilesReader.getRecipientFile` | 0 |
| Decrypt a file (recipient side) | `seal.decryptUnderRecipientFile` | 1 (SessionKey personal message) |

The 2-popup count for the encrypted upload assumes a `WalrusWriteAdapter` that implements `WalrusFlowCapable` (the default `DefaultWalrusWriteAdapter` does). Custom adapters without that capability fall back to 3 popups via the unbundled `seal.encrypt + walrus.uploadBlob + createEncryptedRecipientFile` path.

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
  RpcRecipientFilesReader,
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
const filesReader = RpcRecipientFilesReader.fromConfig(client, {
  packageId: config.packageId,
});
```

## 1. Public upload (no encryption)

Public files store plaintext on Walrus; anyone with the Walrus blob id can download. The on-chain `RecipientFile` still carries a `members` list (creator auto-added), but it does not gate decryption because there is nothing to decrypt. Use the recipient list as a "share with these people in the dapp UI" hint.

```ts
import { uploadRecipientFileFromBytes, toSuiAddress } from "@arcadiasystems/morse-sdk";

const bytes = await file.arrayBuffer().then((b) => new Uint8Array(b));

const result = await uploadRecipientFileFromBytes(adapter, config, {
  walrus: walrusWrite,
  bytes,
  recipients: [toSuiAddress("0xb0b...")],
  name: "report.pdf",
  contentType: "application/pdf",
  upload: { epochs: 3, deletable: true },
  onProgress: (e) => console.log(e.phase),
});

console.log(result.fileId, result.blobId, result.blobObjectId);
```

**2 popups**: Walrus `register_blob`, then a combined PTB (`certify_blob + new_recipient_file + share_recipient_file`).

## 2. Encrypted upload to specific recipients

The marquee flow. Plaintext is encrypted via Seal under a caller-supplied identity prefix; ciphertext is uploaded to Walrus; the file is created on chain with the same prefix bound via a dynamic field. Only addresses in `recipients` (plus the creator) can decrypt.

```ts
import {
  uploadEncryptedRecipientFileFromBytes,
  toSuiAddress,
} from "@arcadiasystems/morse-sdk";

const plaintext = await file.arrayBuffer().then((b) => new Uint8Array(b));

const result = await uploadEncryptedRecipientFileFromBytes(adapter, config, {
  walrus: walrusWrite,
  seal,
  plaintext,
  recipients: [
    toSuiAddress("0xb0b..."),
    toSuiAddress("0xa11ce..."),
  ],
  name: "salaries-q3.pdf",
  contentType: "application/pdf",
  upload: { epochs: 3, deletable: true },
  onProgress: (e) => console.log(e.phase),
});

// Hand `result.sealIdPrefix` and `result.sealNonce` to recipients
// (typically by reading them off the file's event payload server-side).
console.log({
  fileId: result.fileId,
  blobId: result.blobId,
  sealIdPrefix: result.sealIdPrefix,
  sealNonce: result.sealNonce,
});
```

**2 popups**: Walrus `register_blob`, then a combined PTB (`certify_blob + new_recipient_file_with_seal_prefix + share_recipient_file`). The Seal `encrypt` happens between popups and is wallet-free.

### Why a caller-supplied prefix?

Seal binds a chosen `id` byte string into the ciphertext envelope. To open it later, the recipient sends the same bytes to the key servers; the servers dry-run `recipient_file::seal_approve_with_prefix` on chain, which checks (a) the bytes start with the prefix bound to the file at creation, and (b) the sender is in `members`.

Encryption must happen BEFORE the file exists on chain (the file's `blob_id` is the Walrus CID of the ciphertext). The encrypted-upload helper picks a random 32-byte prefix, encrypts with `[prefix || 0x03 || nonce]`, then creates the file with the same prefix attached. The two byte strings line up, recipients can decrypt.

If you want a deterministic prefix (testing, app-controlled identity), pass `sealIdPrefix: Uint8Array` and `sealNonce: Uint8Array` explicitly. Both must be at least 1 byte; 32 + 16 is the recommended pairing.

## 3. Reading a file's metadata

```ts
const file = await filesReader.getRecipientFile(fileId);

file.id;            // RecipientFileId
file.owner;         // SuiAddress: can mutate, decrypt
file.blobId;        // WalrusBlobId: where to fetch bytes from Walrus
file.blobObjectId;  // Sui Blob object id, when known
file.members;       // readonly SuiAddress[]: who can decrypt
file.name;
file.contentType;
file.size;          // plaintext byte length (Walrus blob is larger for encrypted)
file.createdAtMs;
```

## 4. Decrypting (recipient side)

Recipients need: the `fileId`, the `sealIdPrefix` + `sealNonce` (or equivalently the rebuilt `sealId`), and a Seal `SessionKey` signed by their wallet's personal-message signer.

```ts
import { SessionKey } from "@mysten/seal";
import { buildRecipientFileSealId } from "@arcadiasystems/morse-sdk";

// 1. Build a SessionKey. Costs one wallet popup (signPersonalMessage).
const sessionKey = await SessionKey.create({
  address: adapter.address,
  packageId: config.originalPackageId ?? config.packageId,
  ttlMin: 10,
  suiClient: client,
});
const personalMessage = sessionKey.getPersonalMessage();
const { signature } = await adapter.signPersonalMessage(personalMessage);
sessionKey.setPersonalMessageSignature(signature);

// 2. Fetch the ciphertext from Walrus.
const ciphertext = await walrusRead.readBlob(file.blobId);

// 3. Rebuild the Seal identity from prefix + nonce.
const sealId = buildRecipientFileSealId(sealIdPrefix, sealNonce);

// 4. Decrypt. The key servers dry-run `seal_approve_with_prefix(sealId, file)`;
//    non-recipients surface as `SealError("no-access")`.
const plaintext = await seal.decryptUnderRecipientFile(ciphertext, {
  sessionKey,
  sealId,
  fileId: file.id,
});
```

## 5. Modifying recipients

All mutations are owner-only.

```ts
import {
  addRecipient,
  removeRecipient,
  transferRecipientFileOwnership,
  updateRecipientFileMetadata,
  deleteRecipientFile,
} from "@arcadiasystems/morse-sdk";

await addRecipient(adapter, config, { fileId, recipient });
await removeRecipient(adapter, config, { fileId, recipient });

// Move mutation rights to a new owner. Does NOT touch `members`. Compose with
// addRecipient / removeRecipient if you want a full handover (new owner gains
// decrypt, old owner loses it).
await transferRecipientFileOwnership(adapter, config, { fileId, newOwner });

// Rename or change MIME without re-uploading.
await updateRecipientFileMetadata(adapter, config, {
  fileId,
  name: "new-name.pdf",
  contentType: "application/pdf",
});

// Delete the on-chain metadata. Does NOT delete the Walrus blob; that follows
// the Walrus lease lifecycle.
await deleteRecipientFile(adapter, config, { fileId });
```

## 6. Listing files via your indexer

The SDK does not ship event fetching. Sui v2 gRPC has no historical event query, and Mysten is sunsetting `suix_queryEvents` on the JSON-RPC side. The SDK gives you the parsing + reconciliation logic; you pick the indexer.

```ts
import {
  buildRecipientFileEventTypes,
  reconcileRecipientFilesAccessibleBy,
  reconcileRecipientFilesOwnedBy,
} from "@arcadiasystems/morse-sdk";

const eventTypes = buildRecipientFileEventTypes(
  config.recipientFileEventOriginPackageId ?? config.packageId,
);

// Pull all `recipient_file::*` events touching this user from your indexer.
// Shape: { type: string, json: Record<string, unknown>, timestampMs: number }.
const events = await yourIndexer.getEvents({
  types: Object.values(eventTypes),
  involvedAddress: userAddress,
});

// Pure functions; no I/O, no client.
const filesOwned = reconcileRecipientFilesOwnedBy(events, userAddress, eventTypes);
const filesAccessible = reconcileRecipientFilesAccessibleBy(
  events,
  userAddress,
  eventTypes,
);
```

Both reconcile helpers return `RecipientFileSummary[]`. To get the `blobId` and `blobObjectId` (needed to fetch bytes), follow up with `filesReader.getRecipientFile(summary.id)` per row. Use sparingly; the summary list is enough for most UIs.

## 7. Error handling

Errors normalize to a small typed set; switch on `instanceof` rather than parsing messages.

- `ValidationError` - client-side argument shape failures (bad object id, empty string where required).
- `ContractAbortError` - the Move VM aborted. Inspect `module` and `reason`; for the recipient_file module, see `ABORT_CODES.recipient_file` for the names. Common abort reasons:
  - `EUnauthorized` (0): sender is not the file owner.
  - `ERecipientAlreadyPresent` (4): `addRecipient` called for an existing member.
  - `ERecipientNotPresent` (5): `removeRecipient` called for a non-member.
  - `ESealPrefixEmpty` (9): caller supplied an empty `sealIdPrefix`.
  - `ENoAccess` (8): on a decrypt PTB dry-run, sender is not a recipient.
- `SealError` - Seal key server failures. `code` discriminates: `"no-access"` (sender failed `seal_approve_with_prefix`), `"decrypt-failed"`, `"session-expired"`, `"rate-limited"`.
- `UncertifiedBlobError` - the second-leg PTB failed after Walrus uploaded the bytes. `cause` carries the original error; the blob is uncertified and storage is held until expiry. Surface the blobId so the user can retry the certify leg if relevant.
- `TransportError` - RPC, network, or response-parsing failure. `operation` discriminates by call site.
- `NotFoundError` - the requested resource was not found. `resource === "recipient-file"` for `getRecipientFile`.

## 8. Recipes

### "Share a doc with my team" (encrypted)

```ts
const team = [aliceAddr, bobAddr, carolAddr];
const result = await uploadEncryptedRecipientFileFromBytes(adapter, config, {
  walrus: walrusWrite, seal,
  plaintext, recipients: team,
  name: "design-spec.md", contentType: "text/markdown",
  upload: { epochs: 12, deletable: true },
});
```

### "Add Dave to an existing doc"

```ts
await addRecipient(adapter, config, { fileId: result.fileId, recipient: daveAddr });
```

### "Revoke Carol's access"

```ts
await removeRecipient(adapter, config, { fileId: result.fileId, recipient: carolAddr });
```

Note: Seal's decryption material is held by the key servers and rotated per request, so a removal takes effect for any future decrypt attempt. Existing in-memory plaintexts that Carol may have downloaded before removal are out of scope for any on-chain ACL.

### "Hand the file off entirely"

```ts
// New owner can mutate.
await transferRecipientFileOwnership(adapter, config, { fileId, newOwner: davesAddr });
// New owner can decrypt.
await addRecipient(adapter, config, { fileId, recipient: davesAddr });
// Optional: remove old owner from members.
await removeRecipient(adapter, config, { fileId, recipient: oldOwner });
```
