import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configFilePath } from "../src/config/paths.ts";
import { emptyConfig } from "../src/config/schema.ts";
import { loadConfig, saveConfig } from "../src/config/store.ts";

let dir: string;
const savedXdg = process.env.XDG_CONFIG_HOME;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "morse-cfg-"));
	process.env.XDG_CONFIG_HOME = dir;
});

afterEach(async () => {
	if (savedXdg === undefined) {
		delete process.env.XDG_CONFIG_HOME;
	} else {
		process.env.XDG_CONFIG_HOME = savedXdg;
	}
	await rm(dir, { recursive: true, force: true });
});

describe("config store", () => {
	test("a missing file loads as empty config", async () => {
		expect((await loadConfig()).profiles).toEqual({});
	});

	test("round-trips a config and writes it 0600", async () => {
		const cfg = {
			...emptyConfig(),
			defaultProfile: "t",
			profiles: { t: { network: "testnet" as const } },
		};
		await saveConfig(cfg);
		const loaded = await loadConfig();
		expect(loaded.profiles.t?.network).toBe("testnet");
		expect(loaded.defaultProfile).toBe("t");
		const mode = (await stat(configFilePath())).mode & 0o777;
		expect(mode).toBe(0o600);
	});
});
