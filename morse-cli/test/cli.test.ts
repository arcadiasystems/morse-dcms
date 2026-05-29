import { describe, expect, test } from "bun:test";

const ENTRY = new URL("../src/index.ts", import.meta.url).pathname;

interface RunResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

async function run(args: readonly string[]): Promise<RunResult> {
	const proc = Bun.spawn(["bun", ENTRY, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		signal: AbortSignal.timeout(15_000),
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

describe("morse top-level", () => {
	test("--version prints the version on stdout and exits 0", async () => {
		const { code, stdout } = await run(["--version"]);
		expect(code).toBe(0);
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("--help prints usage on stdout and exits 0", async () => {
		const { code, stdout } = await run(["--help"]);
		expect(code).toBe(0);
		expect(stdout).toContain("Usage: morse");
	});

	test("an unknown flag exits 2 with the message on stderr only", async () => {
		const { code, stdout, stderr } = await run(["--nope"]);
		expect(code).toBe(2);
		expect(stdout).toBe("");
		expect(stderr).toContain("unknown option");
	});
});
