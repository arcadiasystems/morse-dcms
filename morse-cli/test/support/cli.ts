/**
 * Shared harness for subprocess CLI tests. One place owns the spawn shape, the
 * timeout, and the dist build so individual test files stay declarative and a
 * slow CI machine cannot flake one file's timeout while another's holds.
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC_ENTRY = new URL("../../src/index.ts", import.meta.url).pathname;
const DIST_ENTRY = new URL("../../dist/index.js", import.meta.url).pathname;
const SRC_DIR = new URL("../../src", import.meta.url).pathname;

// Single knob for every spawn. Cold-starting Bun plus loading the SDK is the
// real cost here; 30s sits well above that without masking a genuine hang.
export const SPAWN_TIMEOUT_MS = 30_000;

export interface RunResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

export interface RunOptions {
	/** Extra environment variables, merged over a NO_COLOR-clean base. */
	readonly env?: Record<string, string>;
	/** Isolated XDG_CONFIG_HOME so tests never touch the developer's config. */
	readonly configDir?: string;
	/** Override the spawn timeout; live e2e needs longer for Walrus uploads. */
	readonly timeoutMs?: number;
}

async function spawn(
	cmd: readonly string[],
	opts: RunOptions,
): Promise<RunResult> {
	const inherited = Object.fromEntries(
		Object.entries(process.env).filter(
			// Drop FORCE_COLOR entirely: it overrides NO_COLOR in color libraries
			// (and Node warns when both are set), which would taint output assertions.
			(entry): entry is [string, string] =>
				entry[1] !== undefined && entry[0] !== "FORCE_COLOR",
		),
	);
	const env: Record<string, string> = {
		...inherited,
		NO_COLOR: "1",
		...(opts.configDir === undefined
			? {}
			: { XDG_CONFIG_HOME: opts.configDir }),
		...opts.env,
	};
	const proc = Bun.spawn([...cmd], {
		stdout: "pipe",
		stderr: "pipe",
		env,
		signal: AbortSignal.timeout(opts.timeoutMs ?? SPAWN_TIMEOUT_MS),
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

/** Run the CLI from TypeScript source under Bun (the fast dev path). */
export function runCli(
	args: readonly string[],
	opts: RunOptions = {},
): Promise<RunResult> {
	return spawn(["bun", SRC_ENTRY, ...args], opts);
}

/** Run the built bundle under plain Node (proves the published artifact). */
export function runDist(
	args: readonly string[],
	opts: RunOptions = {},
): Promise<RunResult> {
	return spawn(["node", DIST_ENTRY, ...args], opts);
}

async function newestSrcMtime(): Promise<number> {
	const glob = new Bun.Glob("**/*.ts");
	let newest = 0;
	for await (const rel of glob.scan(SRC_DIR)) {
		const info = await stat(join(SRC_DIR, rel));
		newest = Math.max(newest, info.mtimeMs);
	}
	return newest;
}

/**
 * Build dist/index.js once, skipping the rebuild when the bundle is newer than
 * every source file. Keeps the cost off the common `bun test` run while giving
 * the artifact and e2e suites a fresh bundle when source has changed.
 */
export async function ensureDist(): Promise<void> {
	const distMtime = await stat(DIST_ENTRY)
		.then((s) => s.mtimeMs)
		.catch(() => 0);
	const srcMtime = await newestSrcMtime();
	// srcMtime === 0 means the scan found nothing (wrong path): rebuild rather
	// than trust a stale bundle.
	if (srcMtime > 0 && distMtime >= srcMtime) {
		return;
	}
	const build = Bun.spawn(["bun", "run", "build"], {
		cwd: new URL("../../", import.meta.url).pathname,
		stdout: "pipe",
		stderr: "pipe",
		signal: AbortSignal.timeout(60_000),
	});
	const code = await build.exited;
	if (code !== 0) {
		throw new Error(`build failed: ${await new Response(build.stderr).text()}`);
	}
}

/** Create an isolated config dir for one test; pair with removeConfigDir. */
export function makeConfigDir(prefix: string): Promise<string> {
	return mkdtemp(join(tmpdir(), prefix));
}

export function removeConfigDir(dir: string): Promise<void> {
	return rm(dir, { recursive: true, force: true });
}
