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
	 * `signTransaction` / `signPersonalMessage` callbacks. Decodes the
	 * signature scheme from `account.publicKey` length and confirms the
	 * derivation matches `account.address`.
	 *
	 * Supported schemes: ED25519 (32-byte raw key), Secp256k1, Secp256r1,
	 * Passkey (all three 33-byte raw keys, disambiguated by address match).
	 *
	 * @throws {ConfigurationError} If the account uses zkLogin or multisig
	 *   (the underlying `Signer` shape and Walrus / Seal expectations don't
	 *   round-trip cleanly), or if no candidate scheme produces an address
	 *   matching `account.address`.
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
 * Wallet-standard `account.publicKey` is the raw key without a flag byte, so
 * a 33-byte payload is structurally ambiguous between Secp256k1, Secp256r1,
 * and Passkey: address derivation (which folds in the scheme flag) is the
 * only reliable disambiguator.
 */
function decodeAccountPublicKey(
	account: WalletStandardAccount,
): DecodedAccountKey {
	const bytes = new Uint8Array(Array.from(account.publicKey));
	const expected = normalizeSuiAddress(account.address);

	if (bytes.length === 32) {
		const publicKey = new Ed25519PublicKey(bytes);
		if (normalizeSuiAddress(publicKey.toSuiAddress()) === expected) {
			return { publicKey, keyScheme: "ED25519" };
		}
		throw new ConfigurationError(
			`WalletStandardSigner: account.publicKey is 32 bytes (Ed25519) but does not derive account.address ${account.address}.`,
		);
	}

	if (bytes.length === 33) {
		const builders: ReadonlyArray<{
			readonly scheme: SignatureScheme;
			readonly build: () => PublicKey;
		}> = [
			{ scheme: "Secp256k1", build: () => new Secp256k1PublicKey(bytes) },
			{ scheme: "Secp256r1", build: () => new Secp256r1PublicKey(bytes) },
			{ scheme: "Passkey", build: () => new PasskeyPublicKey(bytes) },
		];
		for (const { scheme, build } of builders) {
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
		throw new ConfigurationError(
			`WalletStandardSigner: account.publicKey is 33 bytes but does not match Secp256k1, Secp256r1, or Passkey derivation of address ${account.address}.`,
		);
	}

	throw new ConfigurationError(
		`WalletStandardSigner does not support this account: account.publicKey is ${bytes.length} bytes, which suggests a zkLogin, multisig, or unknown signature scheme. Connect a standard keypair account (Ed25519, Secp256k1, Secp256r1, or Passkey) or implement a custom Signer.`,
	);
}
