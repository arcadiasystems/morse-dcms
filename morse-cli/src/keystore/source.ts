/**
 * Resolve a signing keypair from the key-source precedence chain:
 * `MORSE_PRIVATE_KEY` env (raw, never persisted) > the active account's keystore.
 */

import { type SuiAddress, toSuiAddress } from "@arcadiasystems/morse-sdk";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { UsageError } from "../cli/errors.ts";
import { keypairFromSecret, unlockSecret } from "./keystore.ts";
import { resolvePassword } from "./unlock.ts";

export interface ResolvedSigner {
	readonly keypair: Ed25519Keypair;
	readonly address: SuiAddress;
}

type Env = Record<string, string | undefined>;

export async function resolveSigner(
	account: string | undefined,
	env: Env = process.env,
	signal?: AbortSignal,
): Promise<ResolvedSigner> {
	const raw = env.MORSE_PRIVATE_KEY;
	if (raw !== undefined && raw.length > 0) {
		return toSigner(keypairFromSecret(raw));
	}
	if (account === undefined) {
		throw new UsageError(
			"No account selected. Import one with `morse account import`, select it with `morse account use <address>`, or set MORSE_PRIVATE_KEY.",
		);
	}
	const password = await resolvePassword("unlock", env, signal);
	const secret = await unlockSecret(account, password);
	return toSigner(keypairFromSecret(secret));
}

function toSigner(keypair: Ed25519Keypair): ResolvedSigner {
	return { keypair, address: toSuiAddress(keypair.toSuiAddress()) };
}

/**
 * The effective account address without unlocking a keystore: derived from
 * `MORSE_PRIVATE_KEY` when set, otherwise the stored account. Used by reads,
 * which never need to sign.
 */
export function accountAddress(
	account: string | undefined,
	env: Env = process.env,
): SuiAddress | undefined {
	const raw = env.MORSE_PRIVATE_KEY;
	if (raw !== undefined && raw.length > 0) {
		// Address only: no signer is built and no key material is retained here.
		return toSuiAddress(keypairFromSecret(raw).toSuiAddress());
	}
	return account === undefined ? undefined : toSuiAddress(account);
}
