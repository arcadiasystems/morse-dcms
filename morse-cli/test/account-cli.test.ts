import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const ENTRY = new URL("../src/index.ts", import.meta.url).pathname;

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "morse-acct-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

interface RunResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

async function run(
	args: readonly string[],
	extraEnv: Record<string, string> = {},
): Promise<RunResult> {
	const proc = Bun.spawn(["bun", ENTRY, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, XDG_CONFIG_HOME: dir, NO_COLOR: "1", ...extraEnv },
		signal: AbortSignal.timeout(30_000),
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

describe("morse account", () => {
	test("imports non-interactively from env vars and lists the account", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const address = Ed25519Keypair.fromSecretKey(secret).toSuiAddress();
		const imported = await run(["account", "import"], {
			MORSE_PRIVATE_KEY: secret,
			MORSE_KEYSTORE_PASSWORD: "supersecret",
		});
		expect(imported.code).toBe(0);
		expect(imported.stdout).toContain(address);

		const listed = await run(["account", "list"]);
		expect(listed.code).toBe(0);
		expect(listed.stdout).toContain(address);
	});

	test("show derives the address from MORSE_PRIVATE_KEY", async () => {
		const secret = Ed25519Keypair.generate().getSecretKey();
		const address = Ed25519Keypair.fromSecretKey(secret).toSuiAddress();
		const res = await run(["account", "show"], { MORSE_PRIVATE_KEY: secret });
		expect(res.code).toBe(0);
		expect(res.stdout.trim()).toBe(address);
	});

	test("an invalid key exits 2 with the message on stderr only", async () => {
		const res = await run(["account", "import"], {
			MORSE_PRIVATE_KEY: "not-a-real-key",
			MORSE_KEYSTORE_PASSWORD: "supersecret",
		});
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("Invalid private key");
	});

	test("show without any account exits 2", async () => {
		const res = await run(["account", "show"]);
		expect(res.code).toBe(2);
	});
});
