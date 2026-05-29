import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const ENTRY = new URL("../src/index.ts", import.meta.url).pathname;
const SECRET = Ed25519Keypair.generate().getSecretKey();
const VALID_ID = `0x${"1".repeat(64)}`;
const RECIPIENT = `0x${"2".repeat(64)}`;

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "morse-write-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

interface RunResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

// MORSE_PRIVATE_KEY lets the write context build offline; every case here fails
// validation or the non-interactive confirmation before any RPC. The publication
// is always passed as an object id (-P), never a slug, so no network lookup runs.
async function run(args: readonly string[]): Promise<RunResult> {
	const proc = Bun.spawn(["bun", ENTRY, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			XDG_CONFIG_HOME: dir,
			NO_COLOR: "1",
			MORSE_PRIVATE_KEY: SECRET,
		},
		signal: AbortSignal.timeout(15_000),
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

describe("morse write commands (offline guards)", () => {
	test("publication delete without --yes refuses in a non-interactive context (exit 2)", async () => {
		const res = await run(["publication", "delete", VALID_ID]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("--yes");
	});

	test("publication delete with a malformed --owner-cap exits 2", async () => {
		const res = await run([
			"-y",
			"publication",
			"delete",
			VALID_ID,
			"--owner-cap",
			"bad-cap",
		]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
	});

	test("transfer-ownership without --yes refuses in a non-interactive context (exit 2)", async () => {
		const res = await run([
			"publication",
			"transfer-ownership",
			RECIPIENT,
			"-P",
			VALID_ID,
		]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("--yes");
	});

	test("collection create with an invalid --mode exits 2", async () => {
		const res = await run([
			"collection",
			"create",
			"blog",
			"--mode",
			"bogus",
			"-P",
			VALID_ID,
		]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("--mode");
	});

	test("entry add with no --file or --stdin exits 2", async () => {
		const res = await run([
			"entry",
			"add",
			"post",
			"-P",
			VALID_ID,
			"-C",
			"blog",
		]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("--file");
	});

	test("entry delete without --yes refuses in a non-interactive context (exit 2)", async () => {
		const res = await run([
			"entry",
			"delete",
			"0",
			"-P",
			VALID_ID,
			"-C",
			"blog",
		]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("--yes");
	});

	test("revision publish-direct with no content source exits 2", async () => {
		const res = await run([
			"revision",
			"publish-direct",
			"0",
			"-P",
			VALID_ID,
			"-C",
			"blog",
		]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("--file");
	});

	test("revision publish-direct with a bad --epochs exits 2", async () => {
		const res = await run([
			"revision",
			"publish-direct",
			"0",
			"-P",
			VALID_ID,
			"-C",
			"blog",
			"--stdin",
			"--epochs",
			"0",
		]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("--epochs");
	});

	test("cap revoke without --yes refuses in a non-interactive context (exit 2)", async () => {
		const res = await run(["cap", "revoke", VALID_ID, "-P", VALID_ID]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("--yes");
	});

	test("cap issue with a malformed holder address exits 2", async () => {
		const res = await run(["cap", "issue", "not-an-address", "-P", VALID_ID]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
	});

	test("cap destroy without --yes refuses in a non-interactive context (exit 2)", async () => {
		const res = await run(["cap", "destroy", VALID_ID, "-P", VALID_ID]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("--yes");
	});

	test("cap transfer without --yes refuses in a non-interactive context (exit 2)", async () => {
		const res = await run(["cap", "transfer", VALID_ID, RECIPIENT]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("--yes");
	});

	test("cap transfer with a malformed cap id exits 2", async () => {
		const res = await run(["cap", "transfer", "bad-cap", RECIPIENT]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
	});

	test("entry add-encrypted with no content source exits 2", async () => {
		const res = await run([
			"entry",
			"add-encrypted",
			"post",
			"-P",
			VALID_ID,
			"-C",
			"blog",
		]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("--file");
	});

	test("entry decrypt in --json mode without --out exits 2", async () => {
		const res = await run([
			"--json",
			"entry",
			"decrypt",
			"0",
			"-P",
			VALID_ID,
			"-C",
			"blog",
		]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("--out");
	});

	test("entry decrypt with a non-numeric entry id exits 2", async () => {
		const res = await run([
			"entry",
			"decrypt",
			"notanumber",
			"-P",
			VALID_ID,
			"-C",
			"blog",
		]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("entryId");
	});
});
