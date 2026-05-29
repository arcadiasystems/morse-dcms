/**
 * Per-address encrypted keystore files under the config directory. Each file is
 * `0600`; a group/world-readable file is refused on read.
 */

import { chmod, mkdir, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";

import { type SuiAddress, toSuiAddress } from "@arcadiasystems/morse-sdk";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { CliError, KeystoreError, UsageError } from "../cli/errors.ts";
import { ExitCode } from "../cli/exit-codes.ts";
import { fileExists, readJson, writeFileContents } from "../cli/io.ts";
import { keystoreDir } from "../config/paths.ts";
import {
	decryptSecret,
	type EncryptedPayload,
	encryptSecret,
} from "./crypto.ts";

export const KEYSTORE_VERSION = 1;

export interface KeystoreFile extends EncryptedPayload {
	readonly version: number;
	readonly address: SuiAddress;
	readonly kdf: "scrypt";
	readonly cipher: "aes-256-gcm";
}

function keystorePath(address: string): string {
	// Validate to a canonical 0x address so a malformed or crafted value (e.g. a
	// tampered config's `account`) can never traverse outside the keystore dir.
	return join(keystoreDir(), `${toSuiAddress(address)}.json`);
}

/** Construct an Ed25519 keypair from a secret, rejecting malformed input. */
export function keypairFromSecret(secret: string): Ed25519Keypair {
	try {
		return Ed25519Keypair.fromSecretKey(secret);
	} catch {
		throw new UsageError(
			"Invalid private key. Expected a Bech32 `suiprivkey1...` secret key.",
		);
	}
}

/** Encrypt and persist a secret key, returning its derived Sui address. */
export async function importKey(
	secret: string,
	password: string,
): Promise<SuiAddress> {
	const keypair = keypairFromSecret(secret);
	const address = toSuiAddress(keypair.toSuiAddress());
	const payload = await encryptSecret(
		new TextEncoder().encode(secret),
		password,
	);
	const file: KeystoreFile = {
		version: KEYSTORE_VERSION,
		address,
		kdf: "scrypt",
		cipher: "aes-256-gcm",
		...payload,
	};
	await writeKeystore(address, file);
	return address;
}

/** Decrypt the keystore for an address into the raw secret key string. */
export async function unlockSecret(
	address: string,
	password: string,
): Promise<string> {
	const file = await loadKeystore(address);
	const bytes = await decryptSecret(file, password);
	return new TextDecoder().decode(bytes);
}

export async function listAddresses(): Promise<string[]> {
	let entries: string[];
	try {
		entries = await readdir(keystoreDir());
	} catch {
		return [];
	}
	return entries
		.filter((name) => name.endsWith(".json"))
		.map((name) => name.slice(0, -".json".length))
		.sort();
}

export async function hasKeystore(address: string): Promise<boolean> {
	return fileExists(keystorePath(address));
}

export async function loadKeystore(address: string): Promise<KeystoreFile> {
	const path = keystorePath(address);
	if (!(await fileExists(path))) {
		throw new CliError(
			`No keystore for ${address}. Import it with: morse account import`,
			ExitCode.NotFound,
		);
	}
	await assertSecurePermissions(path);
	let raw: unknown;
	try {
		raw = await readJson(path);
	} catch (cause) {
		throw new KeystoreError(`Keystore at ${path} is not valid JSON.`, {
			cause,
		});
	}
	return parseKeystore(raw, path);
}

async function writeKeystore(
	address: string,
	file: KeystoreFile,
): Promise<void> {
	const dir = keystoreDir();
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const path = keystorePath(address);
	const tmp = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
	await writeFileContents(tmp, `${JSON.stringify(file, null, 2)}\n`);
	await chmod(tmp, 0o600);
	await rename(tmp, path);
}

async function assertSecurePermissions(path: string): Promise<void> {
	const mode = (await stat(path)).mode & 0o777;
	if ((mode & 0o077) !== 0) {
		throw new KeystoreError(
			`Keystore ${path} is group/world-accessible (mode ${mode.toString(8)}). Run: chmod 600 ${path}`,
		);
	}
}

function parseKeystore(raw: unknown, path: string): KeystoreFile {
	if (typeof raw !== "object" || raw === null) {
		throw new KeystoreError(`Keystore at ${path} is malformed.`);
	}
	const value = raw as Record<string, unknown>;
	const required = ["address", "salt", "iv", "ciphertext", "authTag"];
	for (const field of required) {
		if (typeof value[field] !== "string") {
			throw new KeystoreError(
				`Keystore at ${path} is missing or has an invalid "${field}".`,
			);
		}
	}
	if (value.version !== KEYSTORE_VERSION) {
		throw new KeystoreError(
			`Keystore at ${path} has an unsupported version (expected ${KEYSTORE_VERSION}).`,
		);
	}
	if (value.kdf !== "scrypt" || value.cipher !== "aes-256-gcm") {
		throw new KeystoreError(
			`Keystore at ${path} uses an unsupported kdf or cipher.`,
		);
	}
	const kdfparams = value.kdfparams;
	if (typeof kdfparams !== "object" || kdfparams === null) {
		throw new KeystoreError(`Keystore at ${path} is missing kdfparams.`);
	}
	assertScryptParams(kdfparams as Record<string, unknown>, path);
	return raw as KeystoreFile;
}

// Bound the scrypt parameters from a (possibly tampered) file: an unbounded N
// would make scrypt allocate ruinous memory and crash or hang the process.
const MAX_SCRYPT_N = 1 << 20;
const MAX_SCRYPT_RP = 64;

function assertScryptParams(
	params: Record<string, unknown>,
	path: string,
): void {
	const { N, r, p } = params;
	const isPowerOfTwo = (n: number): boolean => (n & (n - 1)) === 0;
	if (
		typeof N !== "number" ||
		!Number.isInteger(N) ||
		N < 1 ||
		N > MAX_SCRYPT_N ||
		!isPowerOfTwo(N)
	) {
		throw new KeystoreError(
			`Keystore at ${path} has an out-of-range kdfparams.N.`,
		);
	}
	for (const [name, value] of [
		["r", r],
		["p", p],
	] as const) {
		if (
			typeof value !== "number" ||
			!Number.isInteger(value) ||
			value < 1 ||
			value > MAX_SCRYPT_RP
		) {
			throw new KeystoreError(
				`Keystore at ${path} has an out-of-range kdfparams.${name}.`,
			);
		}
	}
}
