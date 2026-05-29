import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = new URL("../src/index.ts", import.meta.url).pathname;
const VALID_ID = `0x${"1".repeat(64)}`;

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "morse-read-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

interface RunResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

async function run(args: readonly string[]): Promise<RunResult> {
	const proc = Bun.spawn(["bun", ENTRY, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, XDG_CONFIG_HOME: dir, NO_COLOR: "1" },
		signal: AbortSignal.timeout(15_000),
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

// These assert the input-validation exit-code contract, which fires before any
// RPC, so they need no network. Live RPC paths (not-found exit 3, real reads)
// are covered by the testnet smoke.
describe("morse read commands input validation", () => {
	test("publication get with no target and no active publication exits 2", async () => {
		const res = await run(["publication", "get"]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("No publication selected");
	});

	test("entry get with a non-numeric entry id exits 2", async () => {
		const res = await run([
			"entry",
			"get",
			"notanumber",
			"-P",
			VALID_ID,
			"-C",
			"blog",
		]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("entryId");
	});

	test("entry get with no collection selected exits 2", async () => {
		const res = await run(["entry", "get", "0", "-P", VALID_ID]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("No collection selected");
	});

	test("publication list with no address and no account exits 2", async () => {
		const res = await run(["publication", "list"]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("no active account");
	});

	test("entry read in --json mode without --out exits 2", async () => {
		const res = await run([
			"--json",
			"entry",
			"read",
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
});
