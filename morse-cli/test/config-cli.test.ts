import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = new URL("../src/index.ts", import.meta.url).pathname;

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "morse-cli-"));
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

describe("morse config", () => {
	test("add then list shows the profile and marks it default", async () => {
		const add = await run(["config", "add", "tnet", "--network", "testnet"]);
		expect(add.code).toBe(0);
		const list = await run(["config", "list"]);
		expect(list.code).toBe(0);
		expect(list.stdout).toContain("tnet");
		expect(list.stdout).toContain("*");
	});

	test("--json on add emits one JSON object on stdout", async () => {
		const res = await run([
			"--json",
			"config",
			"add",
			"tnet",
			"--network",
			"testnet",
		]);
		expect(res.code).toBe(0);
		const parsed = JSON.parse(res.stdout);
		expect(parsed.profile).toBe("tnet");
		expect(parsed.network).toBe("testnet");
	});

	test("an invalid network exits 2 with the message on stderr only", async () => {
		const res = await run(["config", "add", "x", "--network", "devnet"]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("Unknown network");
	});

	test("use on a missing profile exits 2 with the message on stderr only", async () => {
		const res = await run(["config", "use", "ghost"]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain('No profile named "ghost"');
	});

	test("remove on a missing profile exits 2", async () => {
		const res = await run(["config", "remove", "ghost"]);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain('No profile named "ghost"');
	});

	test("path prints a path under the config dir", async () => {
		const res = await run(["config", "path"]);
		expect(res.code).toBe(0);
		expect(res.stdout.trim()).toContain(dir);
	});
});
