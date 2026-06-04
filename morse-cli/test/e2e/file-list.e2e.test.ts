/**
 * Live testnet check for `morse file list`: upload a public file, then confirm
 * it shows up in the owned-files listing (via suix_queryEvents + the SDK
 * reconcile helpers), then tear it down. Opt-in (MORSE_E2E=1). Event indexing
 * lags behind the write, so the list step retries until the file appears.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	ensureDist,
	makeConfigDir,
	type RunResult,
	removeConfigDir,
	runDist,
} from "../support/cli.ts";

const RUN = process.env.MORSE_E2E === "1";
const STEP_TIMEOUT_MS = 120_000;
const ENV_FILE = new URL("../../.env.testnet", import.meta.url).pathname;

async function loadPrivateKey(): Promise<string> {
	if (process.env.MORSE_PRIVATE_KEY) {
		return process.env.MORSE_PRIVATE_KEY;
	}
	const text = await readFile(ENV_FILE, "utf8").catch(() => "");
	for (const line of text.split("\n")) {
		const match = line.match(/^\s*MORSE_PRIVATE_KEY\s*=\s*(.+?)\s*$/);
		if (match?.[1]) {
			return match[1];
		}
	}
	throw new Error(
		"No testnet key: set MORSE_PRIVATE_KEY or add it to morse-cli/.env.testnet.",
	);
}

describe.if(RUN)("live testnet file list (MORSE_E2E=1)", () => {
	let configDir: string;
	let payloadDir: string;
	let env: Record<string, string>;
	const state: { fileId?: string } = {};

	beforeAll(async () => {
		await ensureDist();
		env = {
			MORSE_PRIVATE_KEY: await loadPrivateKey(),
			MORSE_NETWORK: "testnet",
		};
		configDir = await makeConfigDir("morse-e2e-list-");
		payloadDir = await mkdtemp(join(tmpdir(), "morse-e2e-list-data-"));
	});

	afterAll(async () => {
		if (env !== undefined && state.fileId !== undefined) {
			await run(["file", "delete", state.fileId, "-y"]);
		}
		await removeConfigDir(configDir);
		await rm(payloadDir, { recursive: true, force: true });
	});

	function run(args: readonly string[]): Promise<RunResult> {
		return runDist(args, { configDir, env, timeoutMs: STEP_TIMEOUT_MS });
	}

	async function ok(args: readonly string[]): Promise<RunResult> {
		const res = await run(args);
		if (res.code !== 0) {
			throw new Error(
				`\`${args.join(" ")}\` exited ${res.code}: ${res.stderr}`,
			);
		}
		return res;
	}

	async function okEventually(args: readonly string[]): Promise<RunResult> {
		let last: RunResult | undefined;
		for (let i = 0; i < 4; i += 1) {
			last = await run(args);
			if (last.code === 0) {
				return last;
			}
			await new Promise((resolve) => setTimeout(resolve, 5_000));
		}
		throw new Error(
			`\`${args.join(" ")}\` still failing after 4 attempts: ${last?.stderr}`,
		);
	}

	test(
		"a freshly uploaded public file appears in file list",
		async () => {
			const path = join(payloadDir, "listed.txt");
			await writeFile(path, "listed file payload");
			const uploaded = JSON.parse(
				(
					await okEventually([
						"--json",
						"file",
						"upload",
						path,
						"--name",
						"listed.txt",
						"--public",
					])
				).stdout,
			) as { fileId: string };
			state.fileId = uploaded.fileId;

			let found = false;
			for (let i = 0; i < 6 && !found; i += 1) {
				const items = JSON.parse(
					(await ok(["--json", "file", "list"])).stdout,
				) as Array<{ id: string }>;
				found = items.some((f) => f.id === uploaded.fileId);
				if (!found) {
					await new Promise((resolve) => setTimeout(resolve, 10_000));
				}
			}
			expect(found).toBe(true);
		},
		STEP_TIMEOUT_MS * 4,
	);
});
