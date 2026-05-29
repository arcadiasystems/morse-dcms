/** Load and atomically persist the config file. */

import { chmod, mkdir, rename } from "node:fs/promises";

import { CliError } from "../cli/errors.ts";
import { ExitCode } from "../cli/exit-codes.ts";
import { fileExists, readJson, writeFileContents } from "../cli/io.ts";
import { configDir, configFilePath } from "./paths.ts";
import { type Config, emptyConfig, parseConfig } from "./schema.ts";

export async function loadConfig(): Promise<Config> {
	const path = configFilePath();
	if (!(await fileExists(path))) {
		return emptyConfig();
	}
	let raw: unknown;
	try {
		raw = await readJson(path);
	} catch (cause) {
		throw new CliError(
			`Config file at ${path} is not valid JSON.`,
			ExitCode.Generic,
			{ cause },
		);
	}
	return parseConfig(raw, path);
}

/**
 * Write the config via a temp file plus rename so a crash mid-write cannot leave
 * a truncated file. The directory is `0700` and the file `0600`. Permissions are
 * set on the temp file before the rename so the destination is never briefly
 * world-readable.
 */
export async function saveConfig(config: Config): Promise<void> {
	const dir = configDir();
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const path = configFilePath();
	const tmp = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
	await writeFileContents(tmp, `${JSON.stringify(config, null, 2)}\n`);
	await chmod(tmp, 0o600);
	await rename(tmp, path);
}
