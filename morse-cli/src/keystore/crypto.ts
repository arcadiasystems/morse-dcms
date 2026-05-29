/**
 * Authenticated secret encryption: scrypt-derived key plus AES-256-GCM. A wrong
 * password fails as a GCM auth-tag mismatch on decrypt rather than yielding
 * garbage. Uses `node:crypto` so the security-critical path runs on standard,
 * audited primitives identically on Bun and Node.
 */

import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";

import { KeystoreError } from "../cli/errors.ts";

export interface ScryptParams {
	readonly N: number;
	readonly r: number;
	readonly p: number;
}

export const DEFAULT_SCRYPT: ScryptParams = { N: 1 << 17, r: 8, p: 1 };

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/** Encrypted blob plus the parameters needed to derive the key again. */
export interface EncryptedPayload {
	readonly kdfparams: ScryptParams;
	readonly salt: string;
	readonly iv: string;
	readonly ciphertext: string;
	readonly authTag: string;
}

function deriveKey(
	password: string,
	salt: Buffer,
	params: ScryptParams,
): Buffer {
	// scrypt needs maxmem >= 128 * N * r; the default 32 MB ceiling is too low
	// for N = 2^17, so raise it with headroom.
	const maxmem = 256 * params.N * params.r;
	return scryptSync(password, salt, KEY_LENGTH, {
		N: params.N,
		r: params.r,
		p: params.p,
		maxmem,
	});
}

export async function encryptSecret(
	plaintext: Uint8Array,
	password: string,
	params: ScryptParams = DEFAULT_SCRYPT,
): Promise<EncryptedPayload> {
	const salt = randomBytes(SALT_LENGTH);
	const iv = randomBytes(IV_LENGTH);
	const key = deriveKey(password, salt, params);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	return {
		kdfparams: params,
		salt: salt.toString("base64"),
		iv: iv.toString("base64"),
		ciphertext: ciphertext.toString("base64"),
		authTag: cipher.getAuthTag().toString("base64"),
	};
}

/**
 * Decrypt a payload. Throws `KeystoreError` on a wrong password (GCM auth-tag
 * mismatch) or a tampered blob.
 */
export async function decryptSecret(
	payload: EncryptedPayload,
	password: string,
): Promise<Uint8Array> {
	const salt = Buffer.from(payload.salt, "base64");
	const iv = Buffer.from(payload.iv, "base64");
	const authTag = Buffer.from(payload.authTag, "base64");
	const ciphertext = Buffer.from(payload.ciphertext, "base64");
	const key = deriveKey(password, salt, payload.kdfparams);
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(authTag);
	try {
		const plaintext = Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]);
		return new Uint8Array(plaintext);
	} catch (cause) {
		throw new KeystoreError("Incorrect password or corrupted keystore.", {
			cause,
		});
	}
}
