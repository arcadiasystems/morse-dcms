import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import {
	hasKeystore,
	importKey,
	listAddresses,
	loadKeystore,
	unlockSecret,
} from "../src/keystore/keystore.ts";

let dir: string;
const savedXdg = process.env.XDG_CONFIG_HOME;
const PASSWORD = "test-password-123";

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "morse-ks-"));
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

function keystoreFilePath(address: string): string {
	return join(dir, "morse", "keystores", `${address}.json`);
}

describe("keystore", () => {
	test("import then unlock round-trips the secret and derives the address", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const address = await importKey(secret, PASSWORD);
		expect(address).toMatch(/^0x[0-9a-f]{64}$/);
		expect(await hasKeystore(address)).toBe(true);
		expect(await unlockSecret(address, PASSWORD)).toBe(secret);
		expect(await listAddresses()).toContain(address);
	});

	test("a wrong password fails to unlock", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const address = await importKey(secret, PASSWORD);
		await expect(unlockSecret(address, "wrong-password")).rejects.toThrow();
	});

	test("the keystore file is written 0600", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const address = await importKey(secret, PASSWORD);
		const mode = (await stat(keystoreFilePath(address))).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	test("a group/world-readable keystore is refused", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const address = await importKey(secret, PASSWORD);
		await chmod(keystoreFilePath(address), 0o644);
		await expect(loadKeystore(address)).rejects.toThrow(/group\/world/);
	});

	test("loading a missing keystore throws", async () => {
		await expect(loadKeystore("0xdead")).rejects.toThrow();
	});

	test("a path-traversal account value is rejected before any file access", async () => {
		await expect(loadKeystore("../../../etc/hosts")).rejects.toThrow();
	});

	test("a tampered keystore with an out-of-range scrypt N is rejected", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const address = await importKey(secret, PASSWORD);
		const path = keystoreFilePath(address);
		const file = JSON.parse(await Bun.file(path).text());
		file.kdfparams.N = 2 ** 30; // far above the allowed ceiling
		await Bun.write(path, JSON.stringify(file));
		await expect(loadKeystore(address)).rejects.toThrow(/kdfparams\.N/);
	});
});
