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
import type { Transaction } from "@mysten/sui/transactions";

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
