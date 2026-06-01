import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { makeConfigDir, removeConfigDir, runCli } from "../support/cli.ts";

let dir: string;

beforeEach(async () => {
	dir = await makeConfigDir("morse-cli-");
});

afterEach(async () => {
	await removeConfigDir(dir);
});

describe("morse config", () => {
	test("add then list shows the profile and marks it default", async () => {
		const add = await runCli(
			["config", "add", "tnet", "--network", "testnet"],
			{
				configDir: dir,
			},
		);
		expect(add.code).toBe(0);
		const list = await runCli(["config", "list"], { configDir: dir });
		expect(list.code).toBe(0);
		expect(list.stdout).toContain("tnet");
		expect(list.stdout).toContain("*");
	});

	test("--json on add emits one JSON object on stdout", async () => {
		const res = await runCli(
			["--json", "config", "add", "tnet", "--network", "testnet"],
			{ configDir: dir },
		);
		expect(res.code).toBe(0);
		const parsed = JSON.parse(res.stdout);
		expect(parsed.profile).toBe("tnet");
		expect(parsed.network).toBe("testnet");
	});

	test("an invalid network exits 2 with the message on stderr only", async () => {
		const res = await runCli(["config", "add", "x", "--network", "devnet"], {
			configDir: dir,
		});
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("Unknown network");
	});

	test("use on a missing profile exits 2 with the message on stderr only", async () => {
		const res = await runCli(["config", "use", "ghost"], { configDir: dir });
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain('No profile named "ghost"');
	});

	test("remove on a missing profile exits 2", async () => {
		const res = await runCli(["config", "remove", "ghost"], { configDir: dir });
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain('No profile named "ghost"');
	});

	test("path prints a path under the config dir", async () => {
		const res = await runCli(["config", "path"], { configDir: dir });
		expect(res.code).toBe(0);
		expect(res.stdout.trim()).toContain(dir);
	});
});
