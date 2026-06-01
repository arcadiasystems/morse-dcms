import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { makeConfigDir, removeConfigDir, runCli } from "../support/cli.ts";

const PUB_ID = `0x${"a".repeat(64)}`;

let dir: string;

beforeEach(async () => {
	dir = await makeConfigDir("morse-ctx-");
});

afterEach(async () => {
	await removeConfigDir(dir);
});

describe("morse use / status", () => {
	test("use sets the active publication and status shows it", async () => {
		const used = await runCli(["use", PUB_ID], { configDir: dir });
		expect(used.code).toBe(0);

		const status = await runCli(["status"], { configDir: dir });
		expect(status.code).toBe(0);
		expect(status.stdout).toContain(PUB_ID);
	});

	test("use --clear removes the active publication", async () => {
		await runCli(["use", PUB_ID], { configDir: dir });
		const cleared = await runCli(["use", "--clear"], { configDir: dir });
		expect(cleared.code).toBe(0);

		const status = await runCli(["status"], { configDir: dir });
		expect(status.stdout).toContain("publication: (none)");
	});

	test("use with no publication and no --clear exits 2", async () => {
		const res = await runCli(["use"], { configDir: dir });
		expect(res.code).toBe(2);
		expect(res.stderr).toContain("Provide a publication");
	});

	test("--json status emits a structured object", async () => {
		await runCli(["use", PUB_ID], { configDir: dir });
		const res = await runCli(["--json", "status"], { configDir: dir });
		expect(res.code).toBe(0);
		const parsed = JSON.parse(res.stdout);
		expect(parsed.publication).toBe(PUB_ID);
	});

	test("--json use emits the selected context", async () => {
		const res = await runCli(["--json", "use", PUB_ID], { configDir: dir });
		expect(res.code).toBe(0);
		const parsed = JSON.parse(res.stdout);
		expect(parsed.publication).toBe(PUB_ID);
		expect(parsed.collection).toBeNull();
	});
});
