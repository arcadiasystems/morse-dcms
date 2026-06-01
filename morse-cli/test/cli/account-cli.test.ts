import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { makeConfigDir, removeConfigDir, runCli } from "../support/cli.ts";

let dir: string;

beforeEach(async () => {
	dir = await makeConfigDir("morse-acct-");
});

afterEach(async () => {
	await removeConfigDir(dir);
});

describe("morse account", () => {
	test("imports non-interactively from env vars and lists the account", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const address = Ed25519Keypair.fromSecretKey(secret).toSuiAddress();
		const imported = await runCli(["account", "import"], {
			configDir: dir,
			env: {
				MORSE_PRIVATE_KEY: secret,
				MORSE_KEYSTORE_PASSWORD: "supersecret",
			},
		});
		expect(imported.code).toBe(0);
		expect(imported.stdout).toContain(address);

		const listed = await runCli(["account", "list"], { configDir: dir });
		expect(listed.code).toBe(0);
		expect(listed.stdout).toContain(address);
	});

	test("show derives the address from MORSE_PRIVATE_KEY", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const address = Ed25519Keypair.fromSecretKey(secret).toSuiAddress();
		const res = await runCli(["account", "show"], {
			configDir: dir,
			env: { MORSE_PRIVATE_KEY: secret },
		});
		expect(res.code).toBe(0);
		expect(res.stdout.trim()).toBe(address);
	});

	test("an invalid key exits 2 with the message on stderr only", async () => {
		const res = await runCli(["account", "import"], {
			configDir: dir,
			env: {
				MORSE_PRIVATE_KEY: "not-a-real-key",
				MORSE_KEYSTORE_PASSWORD: "supersecret",
			},
		});
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("Invalid private key");
	});

	test("show without any account exits 2", async () => {
		const res = await runCli(["account", "show"], { configDir: dir });
		expect(res.code).toBe(2);
	});
});
