/**
 * Point XDG_CONFIG_HOME at a fresh temp dir for each test and restore it after,
 * so cores that read or write the config file (updateActiveProfile, config *)
 * stay isolated and never touch the developer's real config.
 */

import { afterEach, beforeEach } from "bun:test";

import { makeConfigDir, removeConfigDir } from "./cli.ts";

// Captured once at import. Safe because Bun isolates each test file in its own
// worker, so this reflects the real ambient value, not a sibling test's temp dir.
const saved = process.env.XDG_CONFIG_HOME;

export function useTempConfigHome(): void {
	let dir: string;
	beforeEach(async () => {
		dir = await makeConfigDir("morse-ut-");
		process.env.XDG_CONFIG_HOME = dir;
	});
	afterEach(async () => {
		if (saved === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = saved;
		}
		await removeConfigDir(dir);
	});
}
