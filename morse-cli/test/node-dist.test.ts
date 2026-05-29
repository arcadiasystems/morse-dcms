import { beforeAll, describe, expect, test } from "bun:test";

// Proves the published bundle runs under plain Node (not just Bun): builds it,
// then executes it with the `node` binary.
const DIST = new URL("../dist/index.js", import.meta.url).pathname;

beforeAll(async () => {
	const build = Bun.spawn(["bun", "run", "build"], {
		stdout: "pipe",
		stderr: "pipe",
		signal: AbortSignal.timeout(60_000),
	});
	const code = await build.exited;
	if (code !== 0) {
		throw new Error(`build failed: ${await new Response(build.stderr).text()}`);
	}
});

describe("built bundle under node", () => {
	test("prints the version under plain node and exits 0", async () => {
		const proc = Bun.spawn(["node", DIST, "--version"], {
			stdout: "pipe",
			stderr: "pipe",
			signal: AbortSignal.timeout(15_000),
		});
		const [stdout, code] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		expect(code).toBe(0);
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("exits 2 on a bad flag under plain node", async () => {
		const proc = Bun.spawn(["node", DIST, "--nope"], {
			stdout: "pipe",
			stderr: "pipe",
			signal: AbortSignal.timeout(15_000),
		});
		const [stdout, code] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		expect(code).toBe(2);
		expect(stdout).toBe("");
	});
});
