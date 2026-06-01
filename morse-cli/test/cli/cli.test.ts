import { describe, expect, test } from "bun:test";

import { runCli } from "../support/cli.ts";

describe("morse top-level", () => {
	test("--version prints the version on stdout and exits 0", async () => {
		const { code, stdout } = await runCli(["--version"]);
		expect(code).toBe(0);
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("--help prints usage on stdout and exits 0", async () => {
		const { code, stdout } = await runCli(["--help"]);
		expect(code).toBe(0);
		expect(stdout).toContain("Usage: morse");
	});

	test("an unknown flag exits 2 with the message on stderr only", async () => {
		const { code, stdout, stderr } = await runCli(["--nope"]);
		expect(code).toBe(2);
		expect(stdout).toBe("");
		expect(stderr).toContain("unknown option");
	});
});
