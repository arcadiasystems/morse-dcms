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

import { ConfigurationError, UnsupportedWalletSchemeError } from "../errors.js";

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
	 * @throws {UnsupportedWalletSchemeError} If the account uses multisig, or
	 *   if no candidate scheme produces an address matching `account.address`.
	 *   The error carries the raw `publicKeyBytes` and `address` so consumers
	 *   can either fall back to `fromAccountAsync` (which recovers the real
	 *   pubkey from a probe signature) or render a wallet-specific CTA.
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

	/**
	 * Async variant of `fromAccount`. On `code === "non-canonical-pubkey"`,
	 * recovers the real Ed25519 key from a probe `signPersonalMessage` and
	 * verifies it derives to `account.address`. One extra wallet popup for
	 * Phantom-class wallets; compliant wallets pay no extra cost.
	 *
	 * Recovery handles Ed25519 only; other schemes throw
	 * `UnsupportedWalletSchemeError` with `code: "recovery-non-ed25519"`.
	 *
	 * @throws {UnsupportedWalletSchemeError} On recovery failure (sig
	 *   length, non-Ed25519 flag, address mismatch). Other failure modes
	 *   from `fromAccount` (zkLogin shape mismatch, etc.) propagate
	 *   verbatim without firing the probe.
	 */
	static async fromAccountAsync(
		account: WalletStandardAccount,
		callbacks: WalletStandardSignerCallbacks,
	): Promise<WalletStandardSigner> {
		try {
			return WalletStandardSigner.fromAccount(account, callbacks);
		} catch (error) {
			if (
				!(error instanceof UnsupportedWalletSchemeError) ||
				error.code !== "non-canonical-pubkey"
			) {
				throw error;
			}
			const recovered = await recoverEd25519PublicKeyFromSignature(
				account,
				callbacks.signPersonalMessage,
			);
			return new WalletStandardSigner({
				publicKey: recovered,
				keyScheme: "ED25519",
				signTransaction: callbacks.signTransaction,
				signPersonalMessage: callbacks.signPersonalMessage,
			});
		}
	}

	override getKeyScheme(): SignatureScheme {
		return this.#keyScheme;
	}

	override getPublicKey(): PublicKey {
		return this.#publicKey;
	}

	override sign(_bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
		throw new ConfigurationError(
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

	// A 0x05-prefixed buffer longer than 33 bytes is shape-consistent with a
	// zkLogin identifier; we already attempted decode above and it failed.
	// Tag it distinctly so the async recovery flow does not fire a probe
	// (zkLogin signs via ZK proof, not Ed25519 — the probe cannot succeed).
	const looksLikeMalformedZkLogin = bytes.length > 33 && bytes[0] === 0x05;
	throw new UnsupportedWalletSchemeError(
		looksLikeMalformedZkLogin
			? `WalletStandardSigner: account.publicKey is ${bytes.length} bytes with a zkLogin-shaped prefix but does not decode to a valid zkLogin identifier for address ${account.address}. The wallet may be misreporting its zkLogin identifier; signature-based recovery is not applicable (zkLogin signs via ZK proof, not Ed25519). Implement a custom Signer.`
			: `WalletStandardSigner: account.publicKey is ${bytes.length} bytes and matches neither a raw nor a flag-prefixed (Sui canonical) form of Ed25519, Secp256k1, Secp256r1, or Passkey, nor a zkLogin identifier, for address ${account.address}. The wallet may be using a non-canonical publicKey encoding (e.g. Phantom's Sui adapter); retry with WalletStandardSigner.fromAccountAsync to recover the real key from a probe signature, or implement a custom Signer.`,
		{
			code: looksLikeMalformedZkLogin
				? "malformed-zklogin"
				: "non-canonical-pubkey",
			publicKeyBytes: bytes,
			address: account.address,
		},
	);
}

/**
 * Length of a canonical Sui Ed25519 signature blob: 1-byte flag (0x00) +
 * 64-byte signature + 32-byte raw pubkey.
 */
const ED25519_SIGNATURE_BLOB_LENGTH = 97;
const ED25519_FLAG = 0x00;
const PROBE_MESSAGE_PREFIX = "morse-sdk:wallet-pubkey-recovery:";

/**
 * Recover the Ed25519 public key by extracting it from a probe signature.
 * Sui's signature blob is `flag || sig || pk` (97 bytes for Ed25519); the
 * last 32 bytes are the raw key. The recovered key is verified to derive
 * to `account.address` before being trusted.
 */
async function recoverEd25519PublicKeyFromSignature(
	account: WalletStandardAccount,
	signPersonalMessage: WalletSignPersonalMessage,
): Promise<Ed25519PublicKey> {
	const probe = new TextEncoder().encode(
		PROBE_MESSAGE_PREFIX + account.address,
	);
	const { signature } = await signPersonalMessage({ message: probe });
	const sigBytes = fromBase64(signature);

	if (sigBytes.length !== ED25519_SIGNATURE_BLOB_LENGTH) {
		throw new UnsupportedWalletSchemeError(
			`Wallet returned a ${sigBytes.length}-byte signature; expected ${ED25519_SIGNATURE_BLOB_LENGTH} bytes (Ed25519 canonical: flag || sig || pk). Recovery from this signature shape is not supported.`,
			{
				code: "recovery-sig-length",
				publicKeyBytes: new Uint8Array(Array.from(account.publicKey)),
				address: account.address,
			},
		);
	}
	if (sigBytes[0] !== ED25519_FLAG) {
		throw new UnsupportedWalletSchemeError(
			`Wallet signed with non-Ed25519 scheme (signature flag 0x${sigBytes[0]?.toString(16).padStart(2, "0")}); recovery is only implemented for Ed25519.`,
			{
				code: "recovery-non-ed25519",
				publicKeyBytes: new Uint8Array(Array.from(account.publicKey)),
				address: account.address,
			},
		);
	}

	const recoveredRaw = sigBytes.slice(65, 97);
	const publicKey = new Ed25519PublicKey(recoveredRaw);
	const derived = normalizeSuiAddress(publicKey.toSuiAddress());
	const expected = normalizeSuiAddress(account.address);
	if (derived !== expected) {
		throw new UnsupportedWalletSchemeError(
			`Pubkey recovered from probe signature derives to ${derived}, which does not match account.address ${expected}. The wallet may have signed with a different key than it advertises.`,
			{
				code: "recovery-address-mismatch",
				publicKeyBytes: new Uint8Array(Array.from(account.publicKey)),
				address: account.address,
			},
		);
	}
	return publicKey;
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
