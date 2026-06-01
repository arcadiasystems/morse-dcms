import { beforeAll, describe, expect, test } from "bun:test";

import { ensureDist, runDist } from "../support/cli.ts";

// Proves the published bundle runs under plain Node (not just Bun): builds it
// (once, when source has changed), then executes it with the `node` binary.
beforeAll(async () => {
	await ensureDist();
});

describe("built bundle under node", () => {
	test("prints the version under plain node and exits 0", async () => {
		const { code, stdout } = await runDist(["--version"]);
		expect(code).toBe(0);
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("exits 2 on a bad flag under plain node", async () => {
		const { code, stdout } = await runDist(["--nope"]);
		expect(code).toBe(2);
		expect(stdout).toBe("");
	});
});
