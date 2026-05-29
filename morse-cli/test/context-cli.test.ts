import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = new URL("../src/index.ts", import.meta.url).pathname;
const PUB_ID = `0x${"a".repeat(64)}`;

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "morse-ctx-"));
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

describe("morse use / status", () => {
	test("use sets the active publication and status shows it", async () => {
		const used = await run(["use", PUB_ID]);
		expect(used.code).toBe(0);

		const status = await run(["status"]);
		expect(status.code).toBe(0);
		expect(status.stdout).toContain(PUB_ID);
	});

	test("use --clear removes the active publication", async () => {
		await run(["use", PUB_ID]);
		const cleared = await run(["use", "--clear"]);
		expect(cleared.code).toBe(0);

		const status = await run(["status"]);
		expect(status.stdout).toContain("publication: (none)");
	});

	test("use with no publication and no --clear exits 2", async () => {
		const res = await run(["use"]);
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("Provide a publication");
	});

	test("--json status emits a structured object", async () => {
		await run(["use", PUB_ID]);
		const res = await run(["--json", "status"]);
		expect(res.code).toBe(0);
		const parsed = JSON.parse(res.stdout);
		expect(parsed.publication).toBe(PUB_ID);
	});

	test("--json use emits the selected context", async () => {
		const res = await run(["--json", "use", PUB_ID]);
		expect(res.code).toBe(0);
		const parsed = JSON.parse(res.stdout);
		expect(parsed.publication).toBe(PUB_ID);
		expect(parsed.collection).toBeNull();
	});
});
