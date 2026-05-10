/**
 * `Signer` subclass that delegates signing to a wallet-standard wallet
 * (Suiet, Sui Wallet, Slush, etc.) via the dapp-kit hooks `useSignTransaction`
 * and `useSignPersonalMessage`. The user's private key never leaves the
 * wallet.
 *
 * Use this when passing a signer to libraries that accept the Sui
 * `@mysten/sui/cryptography` `Signer` abstract — `@mysten/walrus`'s
 * `WalrusClient.writeBlob({ signer })` and `@mysten/seal`'s
 * `SessionKey.create({ signer })`.
 *
 * Methods called by Walrus on the signer: `toSuiAddress`,
 * `signAndExecuteTransaction({ transaction, client })`. Methods called by
 * Seal: `getPublicKey().toSuiAddress()`, `signPersonalMessage(bytes)`. The
 * `sign(bytes)` raw-byte primitive is intentionally not implemented;
 * wallets do not expose raw signing for security reasons. If a future
 * library version invokes `sign(bytes)` or `signTransaction(bytes)`
 * directly (raw-byte form, not the override), this signer throws.
 */

import type { ClientWithCoreApi, SuiClientTypes } from "@mysten/sui/client";
import {
	type PublicKey,
	type SignatureScheme,
	type SignatureWithBytes,
	Signer,
} from "@mysten/sui/cryptography";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { PasskeyPublicKey } from "@mysten/sui/keypairs/passkey";
import { Secp256k1PublicKey } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1PublicKey } from "@mysten/sui/keypairs/secp256r1";
import type { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { ZkLoginPublicIdentifier } from "@mysten/sui/zklogin";

import { ConfigurationError } from "../errors.js";

/**
 * Callback shape returned by dapp-kit's `useSignTransaction.mutateAsync`.
 * The wallet signs and returns the canonical BCS-serialized transaction
 * bytes (base64-encoded) plus the signature; it does not submit.
 */
export type WalletSignTransaction = (input: {
	transaction: Transaction;
}) => Promise<SignatureWithBytes>;

/**
 * Callback shape returned by dapp-kit's `useSignPersonalMessage.mutateAsync`.
 * The wallet signs the personal message and returns the original message
 * bytes (base64-encoded by the wallet) plus the signature.
 */
export type WalletSignPersonalMessage = (input: {
	message: Uint8Array;
}) => Promise<{ bytes: string; signature: string }>;

export interface WalletStandardSignerOptions {
	readonly publicKey: PublicKey;
	readonly keyScheme: SignatureScheme;
	readonly signTransaction: WalletSignTransaction;
	readonly signPersonalMessage: WalletSignPersonalMessage;
}

/**
 * Minimal `WalletAccount` shape consumed by `WalletStandardSigner.fromAccount`.
 * Structurally compatible with `WalletAccount` from `@wallet-standard/base`
 * and `@mysten/wallet-standard`. Defined locally so morse-sdk does not have
 * to take a peer dependency just for this interface.
 */
export interface WalletStandardAccount {
	readonly address: string;
	readonly publicKey: ArrayLike<number>;
}

/** Callback bundle paired with a `WalletStandardAccount` in `fromAccount`. */
export interface WalletStandardSignerCallbacks {
	readonly signTransaction: WalletSignTransaction;
	readonly signPersonalMessage: WalletSignPersonalMessage;
}

/**
 * `Signer` backed by wallet-standard callbacks. Supplies methods Walrus and
 * Seal call; throws on raw-byte signing, which wallets do not expose.
 */
export class WalletStandardSigner extends Signer {
	readonly #publicKey: PublicKey;
	readonly #keyScheme: SignatureScheme;
	readonly #signTransaction: WalletSignTransaction;
	readonly #signPersonalMessage: WalletSignPersonalMessage;

	constructor(options: WalletStandardSignerOptions) {
		super();
		this.#publicKey = options.publicKey;
		this.#keyScheme = options.keyScheme;
		this.#signTransaction = options.signTransaction;
		this.#signPersonalMessage = options.signPersonalMessage;
	}

	/**
	 * Build a signer from a wallet-standard `WalletAccount` plus the wallet's
	 * `signTransaction` / `signPersonalMessage` callbacks. Tries every plausible
	 * interpretation of `account.publicKey` and returns the one whose derived
	 * address matches `account.address`.
	 *
	 * Wallet-standard does not mandate a single encoding for `publicKey`:
	 * Suiet emits raw bytes (e.g. 32 for Ed25519), Slush emits Sui's canonical
	 * with-flag form (e.g. `0x00 || 32-byte raw` for Ed25519). Both are
	 * accepted; address-match disambiguates.
	 *
	 * Supported schemes: ED25519, Secp256k1, Secp256r1, Passkey (raw or
	 * flag-prefixed), and ZkLogin (variable-length identifier of the form
	 * `[1 byte iss-len][iss bytes][32 byte addressSeed]`). MultiSig is
	 * refused.
	 *
	 * Caveat for ZkLogin: the dispatch is structurally correct but
	 * end-to-end behavior against `@mysten/walrus`'s `register_blob` /
	 * `certify_blob` and `@mysten/seal`'s `SessionKey` verification has
	 * not been smoke-tested. If your users see Seal `decrypt-failed` or
	 * Walrus signature errors on zkLogin accounts, fall back to a
	 * keypair account.
	 *
	 * @throws {ConfigurationError} If the account uses multisig, or if no
	 *   candidate scheme produces an address matching `account.address`.
	 */
	static fromAccount(
		account: WalletStandardAccount,
		callbacks: WalletStandardSignerCallbacks,
	): WalletStandardSigner {
		const { publicKey, keyScheme } = decodeAccountPublicKey(account);
		return new WalletStandardSigner({
			publicKey,
			keyScheme,
			signTransaction: callbacks.signTransaction,
			signPersonalMessage: callbacks.signPersonalMessage,
		});
	}

	override getKeyScheme(): SignatureScheme {
		return this.#keyScheme;
	}

	override getPublicKey(): PublicKey {
		return this.#publicKey;
	}

	override sign(_bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
		throw new Error(
			"WalletStandardSigner does not support raw-byte signing. Wallet-standard wallets only sign transactions and personal messages.",
		);
	}

	override async signPersonalMessage(
		message: Uint8Array,
	): Promise<{ bytes: string; signature: string }> {
		return this.#signPersonalMessage({ message });
	}

	/**
	 * Sign and submit a transaction. The wallet pops up to confirm; on approval
	 * it returns canonical BCS bytes plus signature. Those bytes (not any
	 * locally-built bytes) are submitted via the supplied client so the
	 * signature validates against what the wallet actually signed.
	 */
	override async signAndExecuteTransaction({
		transaction,
		client,
	}: {
		transaction: Transaction;
		client: ClientWithCoreApi;
	}): Promise<
		SuiClientTypes.TransactionResult<{
			transaction: true;
			effects: true;
		}>
	> {
		transaction.setSenderIfNotSet(this.toSuiAddress());
		const { bytes, signature } = await this.#signTransaction({ transaction });
		return client.core.executeTransaction({
			transaction: fromBase64(bytes),
			signatures: [signature],
			include: { transaction: true, effects: true },
		});
	}
}

function fromBase64(value: string): Uint8Array {
	const binary = atob(value);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}

interface DecodedAccountKey {
	readonly publicKey: PublicKey;
	readonly keyScheme: SignatureScheme;
}

/**
 * Pick the `PublicKey` subclass whose Sui address matches `account.address`.
 * Wallet-standard does not mandate a single encoding for `account.publicKey`:
 * Suiet emits the raw key bytes; Slush emits Sui's canonical "with-flag" form
 * (`flagByte || rawKey`). Both are valid, so the decoder tries every plausible
 * (length, leading-byte) interpretation and picks the one whose address
 * derivation matches the wallet-reported address. Address-match is the only
 * reliable disambiguator because the scheme flag folds into the address hash.
 */
function decodeAccountPublicKey(
	account: WalletStandardAccount,
): DecodedAccountKey {
	const bytes = new Uint8Array(Array.from(account.publicKey));
	const expected = normalizeSuiAddress(account.address);

	const candidates = candidateInterpretations(bytes);
	for (const { scheme, build } of candidates) {
		let publicKey: PublicKey;
		try {
			publicKey = build();
		} catch {
			continue;
		}
		if (normalizeSuiAddress(publicKey.toSuiAddress()) === expected) {
			return { publicKey, keyScheme: scheme };
		}
	}

	// ZkLogin pub identifier is `[1 byte iss-len][iss bytes][32 byte addressSeed]`,
	// always > 33 bytes. `fromBytes({ address })` auto-tries non-legacy then
	// legacy address derivation and throws on mismatch; treat throw as
	// "not zkLogin" and fall through to refusal so multisig and garbage
	// bytes don't get silently labeled as zkLogin.
	if (bytes.length > 33) {
		try {
			const publicKey = ZkLoginPublicIdentifier.fromBytes(bytes, {
				address: account.address,
			});
			return { publicKey, keyScheme: "ZkLogin" };
		} catch {
			// Fall through.
		}
	}

	throw new ConfigurationError(
		`WalletStandardSigner: account.publicKey is ${bytes.length} bytes and matches neither a raw nor a flag-prefixed (Sui canonical) form of Ed25519, Secp256k1, Secp256r1, or Passkey, nor a zkLogin identifier, for address ${account.address}. This suggests a multisig or unknown signature scheme; implement a custom Signer.`,
	);
}

interface SchemeCandidate {
	readonly scheme: SignatureScheme;
	readonly build: () => PublicKey;
}

/**
 * Build the list of (scheme, public-key-constructor) pairs to try against
 * `account.address`. Covers raw bytes (Suiet-style) and flag-prefixed bytes
 * (Sui canonical / Slush-style). Order is stable but irrelevant for
 * correctness — address-match disambiguates.
 */
function candidateInterpretations(
	bytes: Uint8Array,
): readonly SchemeCandidate[] {
	const list: SchemeCandidate[] = [];

	if (bytes.length === 32) {
		list.push({
			scheme: "ED25519",
			build: () => new Ed25519PublicKey(bytes),
		});
	}

	if (bytes.length === 33) {
		list.push(
			{ scheme: "Secp256k1", build: () => new Secp256k1PublicKey(bytes) },
			{ scheme: "Secp256r1", build: () => new Secp256r1PublicKey(bytes) },
			{ scheme: "Passkey", build: () => new PasskeyPublicKey(bytes) },
		);
		// Sui canonical Ed25519 with-flag: 0x00 || 32-byte raw key.
		if (bytes[0] === 0x00) {
			const inner = bytes.slice(1);
			list.push({
				scheme: "ED25519",
				build: () => new Ed25519PublicKey(inner),
			});
		}
	}

	if (bytes.length === 34) {
		const inner = bytes.slice(1);
		// Sui canonical with-flag forms: flag || 33-byte compressed point.
		if (bytes[0] === 0x01) {
			list.push({
				scheme: "Secp256k1",
				build: () => new Secp256k1PublicKey(inner),
			});
		}
		if (bytes[0] === 0x02) {
			list.push({
				scheme: "Secp256r1",
				build: () => new Secp256r1PublicKey(inner),
			});
		}
		if (bytes[0] === 0x06) {
			list.push({
				scheme: "Passkey",
				build: () => new PasskeyPublicKey(inner),
			});
		}
	}

	return list;
}
