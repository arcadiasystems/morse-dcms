/**
 * Per-test temp files for content-upload cores that read `--file <path>`. The
 * directory is created fresh per test and removed after, so reads stay isolated.
 */

import { afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempFiles {
	write(name: string, content: string | Uint8Array): Promise<string>;
	/** A path in the temp dir, not created; for output targets like --out. */
	path(name: string): string;
}

export function useTempFiles(): TempFiles {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "morse-content-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});
	return {
		async write(name, content) {
			const path = join(dir, name);
			await writeFile(path, content);
			return path;
		},
		path(name) {
			return join(dir, name);
		},
	};
}
