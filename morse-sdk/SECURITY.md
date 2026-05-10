# Security policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in `morse-sdk`, please report it privately rather than opening a public GitHub issue. Email **andreja@hypersignals.ai** with:

- A description of the issue and its potential impact.
- Steps to reproduce, ideally with a minimal code snippet or testnet transaction reference.
- The morse-sdk version, the resolved versions of `@mysten/sui` / `@mysten/walrus` / `@mysten/seal`, and the Sui network you observed it on.

We aim to acknowledge reports within 72 hours and to provide an initial assessment within one week. Coordinated disclosure: if a fix requires a contract update or upstream coordination with Mysten, we'll keep you in the loop on timing.

## Scope

The morse-sdk security model is layered across SDK code, the Move contracts in `morse-contracts/`, and the Mysten substrate (`@mysten/sui`, `@mysten/walrus`, `@mysten/seal`). Reports about substrate behavior should also be sent upstream to Mysten Labs. Reports about Move contract bugs are handled in the [`morse-contracts`](../morse-contracts/) tree.

In scope for morse-sdk specifically:

- Logic bugs in the SDK that cause incorrect on-chain effects (e.g. wrong PTB construction, incorrect cap routing, malformed BCS encoding).
- Type-safety holes that allow consumer code to construct a misformatted identity, address, or blob reference and submit it without client-side validation.
- Adapter-pattern violations that leak private material (the SDK never reads private keys; consumers supply signers, and the SDK should never serialize them or surface them in errors).
- Error-mapping bugs that hide a security-relevant failure as a benign `TransportError`.

Out of scope:

- Walrus storage-node availability, rate-limiting, or storage-node-side bugs.
- Sui validator behavior, gas pricing, or chain-level consensus issues.
- Seal key-server availability or trust assumptions on the canonical testnet allowlist (escalate to Mysten Labs).
- Issues in upstream `@mysten/*` libraries; please escalate to Mysten Labs directly.

## Security model — what stays where

morse-sdk is designed so the consumer's wallet is the only place that holds private signing material. Specifically:

- `WalletAdapter` (and its default `KeypairAdapter`) is the only SDK surface that takes a signing key. Browser flows substitute `WalletStandardSigner` so the dapp never holds the user's key — wallet popups handle every signature.
- The SDK never reads, serializes, or logs private keys. Errors thrown by the SDK include the cause (the upstream error) but never the signer.
- Encrypted content is encrypted client-side by `@mysten/seal` before it reaches Walrus storage nodes. The on-chain `sealId` is the identity used by Seal's threshold-encryption key servers; ciphertext alone is not enough to decrypt.
- Wallet-standard public keys go through `WalletStandardSigner.fromAccount`, which validates the address derives from the supplied public key (rejects a wallet that returns inconsistent values).

If a vulnerability claim contradicts any of these, please flag it explicitly in your report.

## Versioning and patches

- Pre-1.0 (`0.x.y`): security fixes ship as a `0.x.y` patch version. Compatibility with the same Mysten substrate range is preserved within a patch line.
- Post-1.0 (planned): security fixes will ship per [Semantic Versioning](https://semver.org/) with backports to the latest minor of each supported major.
