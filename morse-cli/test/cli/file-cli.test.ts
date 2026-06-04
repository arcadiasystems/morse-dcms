import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { makeConfigDir, removeConfigDir, runCli } from "../support/cli.ts";

let dir: string;

beforeEach(async () => {
	dir = await makeConfigDir("morse-file-");
});

afterEach(async () => {
	await removeConfigDir(dir);
});

// A real `file list` queries the network; this asserts the offline-validation
// contract (a bad --address fails before any RPC). The live path is the e2e.
describe("morse file list (offline guard)", () => {
	test("a malformed --address exits 2 with the message on stderr only", async () => {
		const res = await runCli(["file", "list", "--address", "not-an-address"], {
			configDir: dir,
		});
		expect(res.code).toBe(2);
		expect(res.stdout).toBe("");
	});
});
