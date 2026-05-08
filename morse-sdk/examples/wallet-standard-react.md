# Browser wallet integration (React + dapp-kit + Suiet)

Worked example showing how to wire morse-sdk into a React app using a
wallet-standard-compatible wallet such as [Suiet](https://suiet.app/),
[Sui Wallet](https://suiwallet.com/), or [Slush](https://slush.app/).

The shape works with any wallet-standard wallet: dapp-kit's
`WalletProvider` discovers all installed wallets through the protocol;
the user picks one in the connect modal. `examples/wallet-standard.ts`
defines the `WalletStandardAdapter` class this snippet uses.

## Install

```sh
bun add morse-sdk @mysten/sui @mysten/dapp-kit @tanstack/react-query react react-dom
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

## Wiring the adapter

```tsx
// src/useMorseAdapter.ts
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  morseConfig,
  RpcPublicationReader,
} from "morse-sdk";
import { useMemo } from "react";

import { WalletStandardAdapter } from "./WalletStandardAdapter";
// ^ class defined in examples/wallet-standard.ts; copy into your app.

export function useMorseAdapter() {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  return useMemo(() => {
    if (!account) return null;
    const config = morseConfig({ network: "testnet" });
    const client = new SuiGrpcClient({
      network: "testnet",
      baseUrl: config.rpcUrl,
    });
    const adapter = new WalletStandardAdapter(
      account.address,
      ({ transaction }) => signAndExecute({ transaction }),
      client,
    );
    const reader = RpcPublicationReader.fromMorseConfig(config, client);
    return { adapter, reader, config, client };
  }, [account, signAndExecute]);
}
```

The hook returns `null` until a wallet is connected. Once connected, it
returns `{ adapter, reader, config, client }` ready to pass to any morse-sdk
op.

## Using it

```tsx
// src/CreatePublicationButton.tsx
import { createPublication } from "morse-sdk";
import { useMorseAdapter } from "./useMorseAdapter";

export function CreatePublicationButton() {
  const morse = useMorseAdapter();
  if (!morse) return <p>Connect a wallet to continue.</p>;

  async function onClick() {
    const result = await createPublication(morse.adapter, morse.config, {
      name: "My Publication",
      slug: "my-publication",
    });
    console.log("created", result.publicationId);
  }

  return <button onClick={onClick}>Create publication</button>;
}
```

When the user clicks, Suiet (or whichever wallet they connected) pops up
its native confirmation dialog. The user approves, the wallet returns
the digest, and the SDK polls for finality.

## Encrypted entries (Seal SessionKey)

Encrypted decryption needs a `SessionKey`, which the wallet must sign
(personal message). dapp-kit exposes the corresponding hook:

```tsx
import { useSignPersonalMessage } from "@mysten/dapp-kit";
import { SessionKey } from "@mysten/seal";

const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

const sessionKey = await SessionKey.create({
  address: account.address,
  packageId: config.originalPackageId ?? config.packageId,
  ttlMin: 10,
  signer: {
    signPersonalMessage: async (message: Uint8Array) => {
      const result = await signPersonalMessage({ message });
      // Adapt to the shape `@mysten/seal` expects; see version-specific
      // docs for the precise return shape.
      return result;
    },
  } as Parameters<typeof SessionKey.create>[0]["signer"],
  suiClient: client,
});
```

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
