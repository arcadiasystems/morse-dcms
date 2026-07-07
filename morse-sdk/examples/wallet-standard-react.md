# Browser wallet integration (React + dapp-kit + Suiet)

Worked example showing how to wire morse-sdk into a React app using a
wallet-standard-compatible wallet such as [Suiet](https://suiet.app/),
[Sui Wallet](https://suiwallet.com/), or [Slush](https://slush.app/).

The shape works with any wallet-standard wallet: dapp-kit's
`WalletProvider` discovers all installed wallets through the protocol;
the user picks one in the connect modal.

Two pieces collaborate:
- `WalletStandardAdapter` (defined in `examples/wallet-standard.ts`) for
  morse-sdk's own ops (createPublication, addEntry, etc.).
- `WalletStandardSigner` (shipped from `morse-sdk`) for libraries that
  accept Sui's `Signer` abstract — `@mysten/walrus` (uploads) and
  `@mysten/seal` (`SessionKey.create` for decrypt).

## Install

```sh
bun add @arcadiasystems/morse-sdk @mysten/sui @mysten/dapp-kit @tanstack/react-query react react-dom
# Optional, depending on which morse-sdk surface you use:
bun add @mysten/walrus @mysten/seal
```

`@mysten/dapp-kit` requires `@tanstack/react-query` as a peer dependency.

## Provider setup

```tsx
// src/main.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getFullnodeUrl } from "@mysten/sui/client";
import { createRoot } from "react-dom/client";
import "@mysten/dapp-kit/dist/index.css";

import { App } from "./App";

const queryClient = new QueryClient();
const networks = {
  testnet: { url: getFullnodeUrl("testnet") },
};

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <SuiClientProvider networks={networks} defaultNetwork="testnet">
      <WalletProvider autoConnect>
        <App />
      </WalletProvider>
    </SuiClientProvider>
  </QueryClientProvider>,
);
```

Suiet must be installed as a browser extension. After install, refresh
the page; Suiet's wallet-standard registration appears in the dapp-kit
connect modal alongside any other installed wallets.

## Connect button

```tsx
// src/ConnectButton.tsx
import { ConnectButton } from "@mysten/dapp-kit";

export function Header() {
  return (
    <header>
      <ConnectButton />
    </header>
  );
}
```

The `ConnectButton` component from dapp-kit handles wallet discovery
(Suiet, Sui Wallet, Slush, etc.), connection, and disconnection. No
Suiet-specific code is needed here.

## Wiring the adapter and signer

```tsx
// src/useMorseAdapter.ts
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSignPersonalMessage,
  useSignTransaction,
} from "@mysten/dapp-kit";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  morseConfig,
  RpcPublicationReader,
  WalletStandardSigner,
} from "@arcadiasystems/morse-sdk";
import { useMemo } from "react";

import { WalletStandardAdapter } from "./WalletStandardAdapter";
// ^ class defined in examples/wallet-standard.ts; copy into your app.

export function useMorse() {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { mutateAsync: signTransaction } = useSignTransaction();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  return useMemo(() => {
    if (!account) return null;
    const config = morseConfig({ network: "testnet" });
    const client = new SuiGrpcClient({
      network: "testnet",
      baseUrl: config.rpcUrl,
    });

    // For morse-sdk ops (createPublication, addEntry, ...).
    const adapter = new WalletStandardAdapter(
      account.address,
      ({ transaction }) => signAndExecute({ transaction }),
      client,
    );

    // For Walrus uploads and Seal SessionKey - both want a Sui `Signer`.
    // `fromAccount` decodes the scheme from the wallet's raw public key
    // and refuses zkLogin / multisig accounts at construction time.
    const signer = WalletStandardSigner.fromAccount(account, {
      signTransaction: ({ transaction }) => signTransaction({ transaction }),
      signPersonalMessage: ({ message }) => signPersonalMessage({ message }),
    });

    const reader = RpcPublicationReader.fromMorseConfig(config, client);
    return { adapter, signer, reader, config, client };
  }, [account, signAndExecute, signTransaction, signPersonalMessage]);
}
```

The hook returns `null` until a wallet is connected. Once connected, it
returns `{ adapter, signer, reader, config, client }` — pass `adapter` to
morse-sdk ops, `signer` to Walrus and Seal.

`fromAccount` decodes Ed25519, Secp256k1, Secp256r1, Passkey, and
ZkLogin accounts. MultiSig is refused with `ConfigurationError`.

The ZkLogin path is structural — the dispatch is correct but Walrus and
Seal end-to-end behavior with zkLogin signatures is unverified at the
time of writing (see the compatibility table in the SDK README). For
production, prefer keypair / passkey accounts until you have smoke-tested
your specific Walrus + Seal versions against a Slush zkLogin account.

Wrap `fromAccount` in a try/catch (or surface the thrown
`ConfigurationError` from a hook) so an unsupported wallet account
renders as product copy ("this wallet account isn't supported yet")
rather than crashing the page.

## Using it

```tsx
// src/CreatePublicationButton.tsx
import { createPublication } from "@arcadiasystems/morse-sdk";
import { useMorseAdapter } from "./useMorseAdapter";

export function CreatePublicationButton() {
  const morse = useMorseAdapter();
  if (!morse) return <p>Connect a wallet to continue.</p>;

  async function onClick() {
    const result = await createPublication(morse.adapter, morse.config, {
      name: "My Publication",
      slug: `my-pub-${Date.now()}`, // slugs are globally unique on-chain
    });
    console.log("created", result.publicationId);
  }

  return <button onClick={onClick}>Create publication</button>;
}
```

When the user clicks, Suiet (or whichever wallet they connected) pops up
its native confirmation dialog. The user approves, the wallet returns
the digest, and the SDK polls for finality.

## Walrus upload through the wallet

Walrus's `WalrusClient` requires a Sui `Signer`. With
`WalletStandardSigner` from the hook above, browser dapps can upload
without ever holding the user's private key — every Walrus-side
transaction (`register_blob`, `certify_blob`) routes through the wallet
popup.

```tsx
// src/UploadButton.tsx
import { addEntry, DefaultWalrusWriteAdapter } from "@arcadiasystems/morse-sdk";

import { useMorse } from "./useMorseAdapter";

export function UploadButton({
  publicationId,
  publisherCapId,
}: {
  publicationId: string;
  publisherCapId: string;
}) {
  const morse = useMorse();
  if (!morse) return <p>Connect a wallet to continue.</p>;

  async function onClick() {
    // Build the Walrus adapter once per session against the wallet signer.
    const walrus = DefaultWalrusWriteAdapter.fromConfig(
      { network: "testnet", suiClient: morse.client },
      morse.signer,
    );

    // Wallet pops up to confirm the register_blob and certify_blob txs.
    const blob = await walrus.uploadBlob(
      new TextEncoder().encode("hello from a wallet"),
      { epochs: 3, deletable: true },
    );

    // Reference the freshly-uploaded blob in an entry.
    const entry = await addEntry(morse.adapter, morse.config, {
      publicationId,
      publisherCapId,
      collectionName: "blog",
      name: "first-post",
      blobObjectId: blob.blobObjectId,
      contentType: "text/plain",
    });
    console.log("created entry", entry.entryId);
  }

  return <button onClick={onClick}>Upload + add entry</button>;
}
```

## Encrypted entries (Seal SessionKey)

`morseConfig({ network: "testnet" })` ships with a `sealKeyServers`
field pre-populated with the canonical testnet allowlist. End users
never see a key-server config; developers don't paste objectIds.

The `WalletStandardSigner` from `useMorse()` plugs straight into Seal —
the library calls only `signer.getPublicKey().toSuiAddress()` and
`signer.signPersonalMessage(bytes)`, both routed to the wallet popup
through the hooks already wired in.

```tsx
import { DefaultSealAdapter, SessionKey } from "@arcadiasystems/morse-sdk";

const { signer, config, client } = morse;

// Encrypt: no JSON paste, no threshold input.
const seal = DefaultSealAdapter.fromMorseConfig(config, {}, client);
const { ciphertext } = await seal.encrypt(plaintext, { sealId });

// Decrypt: build a SessionKey via the wallet, then ask Seal to recover bytes.
const sessionKey = await SessionKey.create({
  address: signer.toSuiAddress(),
  packageId: config.originalPackageId ?? config.packageId,
  ttlMin: 10,
  signer,
  suiClient: client,
});
const recovered = await seal.decrypt(ciphertext, {
  sessionKey,
  sealId,
  publisherCapId,
});
```

Custom server sets (paid plans, alternate trust assumptions, region
pinning) override via `DefaultSealAdapter.fromMorseConfig(config, {
serverConfigs }, client)`. The default path is the right one for almost
every dapp.

Suiet's personal-message signing is identical to other wallets' in this
flow — wallet-standard normalizes it.

## Notes specific to Suiet

- Suiet exposes its testnet/mainnet network selector inside the wallet
  itself; dapp-kit's `defaultNetwork` controls which network the SDK
  talks to. Make sure the two match before testing.
- Suiet supports both Ed25519 and Secp256k1 accounts; both are signed
  through the same `signAndExecuteTransaction` path, no SDK-side change.
- For testnet, get SUI from [Sui's testnet faucet](https://faucet.sui.io/)
  and WAL via the [Walrus testnet faucet](https://docs.walrus.site/usage/web-tool.html#testnet-tokens).
  Suiet displays both balances.

## Other wallets (no changes needed)

The same code works without modification for:
- [Sui Wallet](https://suiwallet.com/)
- [Slush](https://slush.app/) (formerly Surf Wallet)
- Phantom (Sui plugin)
- Backpack
- Any other wallet that registers via `@wallet-standard/core`

The user picks which wallet to connect in dapp-kit's modal; the SDK never
sees which wallet is in use, only the wallet-standard interface.
