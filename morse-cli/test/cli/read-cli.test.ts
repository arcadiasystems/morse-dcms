import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { makeConfigDir, removeConfigDir, runCli } from "../support/cli.ts";

const VALID_ID = `0x${"1".repeat(64)}`;

let dir: string;

beforeEach(async () => {
	dir = await makeConfigDir("morse-read-");
});

afterEach(async () => {
	await removeConfigDir(dir);
});

// These assert the input-validation exit-code contract, which fires before any
// RPC, so they need no network. Live RPC paths (not-found exit 3, real reads)
// are covered by the testnet smoke.
describe("morse read commands input validation", () => {
	test("publication get with no target and no active publication exits 2", async () => {
		const res = await runCli(["publication", "get"], { configDir: dir });
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("No publication selected");
	});

	test("entry get with a non-numeric entry id exits 2", async () => {
		const res = await runCli(
			["entry", "get", "notanumber", "-P", VALID_ID, "-C", "blog"],
			{
				configDir: dir,
			},
		);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("entryId");
	});

	test("entry get with no collection selected exits 2", async () => {
		const res = await runCli(["entry", "get", "0", "-P", VALID_ID], {
			configDir: dir,
		});
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("No collection selected");
	});

	test("publication list with no address and no account exits 2", async () => {
		const res = await runCli(["publication", "list"], { configDir: dir });
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("no active account");
	});

	test("entry read in --json mode without --out exits 2", async () => {
		const res = await runCli(
			["--json", "entry", "read", "0", "-P", VALID_ID, "-C", "blog"],
			{ configDir: dir },
		);
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain("--out");
	});
});
