import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { KeystoreError } from "../src/cli/errors.ts";
import { ExitCode } from "../src/cli/exit-codes.ts";
import { importKey } from "../src/keystore/keystore.ts";
import { resolveSigner } from "../src/keystore/source.ts";

let dir: string;
const savedXdg = process.env.XDG_CONFIG_HOME;
const PASSWORD = "unlock-password-1";

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "morse-src-"));
	process.env.XDG_CONFIG_HOME = dir;
});

afterEach(async () => {
	if (savedXdg === undefined) {
		delete process.env.XDG_CONFIG_HOME;
	} else {
		process.env.XDG_CONFIG_HOME = savedXdg;
	}
	await rm(dir, { recursive: true, force: true });
});

describe("resolveSigner", () => {
	test("prefers MORSE_PRIVATE_KEY over the keystore", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const expected = Ed25519Keypair.fromSecretKey(secret).toSuiAddress();
		const signer = await resolveSigner(undefined, {
			MORSE_PRIVATE_KEY: secret,
		});
		expect(String(signer.address)).toBe(expected);
	});

	test("unlocks a keystore with the correct password", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const address = await importKey(secret, PASSWORD);
		const signer = await resolveSigner(address, {
			MORSE_KEYSTORE_PASSWORD: PASSWORD,
		});
		expect(signer.address).toBe(address);
	});

	test("a wrong password throws KeystoreError carrying exit code 4", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const address = await importKey(secret, PASSWORD);
		let caught: unknown;
		try {
			await resolveSigner(address, { MORSE_KEYSTORE_PASSWORD: "wrong" });
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(KeystoreError);
		expect((caught as KeystoreError).exitCode).toBe(ExitCode.Auth);
	});

	test("no account and no MORSE_PRIVATE_KEY throws", async () => {
		await expect(resolveSigner(undefined, {})).rejects.toThrow();
	});
});
