/**
 * Live testnet lifecycle through the built bundle. Opt-in: runs only when
 * MORSE_E2E=1, so the default `bun test` gate never touches the network. This is
 * the only layer that exercises real RPC, Walrus uploads/reads, and Seal
 * encrypt/decrypt end to end, including the two round-trips the hermetic suite
 * cannot cover (entry read and entry decrypt).
 *
 * The lifecycle is split into ordered steps so Bun reports each as pass/fail and
 * you can see exactly where a run stops (for example, an `entry add` that
 * succeeds while `entry read` fails points at a Walrus read-side outage rather
 * than the CLI). Steps share state and run in order; teardown is best-effort.
 *
 * Requires a funded testnet account: set MORSE_PRIVATE_KEY (or a .env.testnet
 * file with that key beside this package) holding testnet SUI for gas and WAL
 * for the Walrus uploads. Run with: bun run test:e2e
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
// Set MORSE_E2E_AGGREGATOR=1 to route the read steps through the Walrus
// aggregator (--via-aggregator) instead of the storage-node protocol; useful to
// check whether the aggregator path clears a storage-node read outage.
const READ_FLAGS =
	process.env.MORSE_E2E_AGGREGATOR === "1" ? ["--via-aggregator"] : [];
// Walrus writes can take well over the default spawn timeout.
const STEP_TIMEOUT_MS = 120_000;
const ENV_FILE = new URL("../../.env.testnet", import.meta.url).pathname;
const PAYLOAD = "hello morse e2e";
const REVISED = "hello morse e2e, revised";
const SECRET = "top secret e2e payload";

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

describe.if(RUN)("live testnet lifecycle (MORSE_E2E=1)", () => {
	let configDir: string;
	let payloadDir: string;
	let env: Record<string, string>;
	// Carried between ordered steps; teardown reads these for cleanup.
	const state: {
		entryId?: string;
		encryptedEntryId?: string;
		publicationCreated: boolean;
	} = { publicationCreated: false };

	beforeAll(async () => {
		await ensureDist();
		env = {
			MORSE_PRIVATE_KEY: await loadPrivateKey(),
			MORSE_NETWORK: "testnet",
		};
		configDir = await makeConfigDir("morse-e2e-cfg-");
		payloadDir = await mkdtemp(join(tmpdir(), "morse-e2e-data-"));
	});

	afterAll(async () => {
		// Best-effort teardown so a run leaves no testnet objects behind.
		if (env !== undefined) {
			if (state.entryId !== undefined) {
				await run(["entry", "delete", state.entryId, "-y"]);
			}
			if (state.encryptedEntryId !== undefined) {
				await run(["entry", "delete", state.encryptedEntryId, "-y"]);
			}
			await run(["collection", "delete", "posts", "-y"]);
			if (state.publicationCreated) {
				await run(["publication", "delete", "-y"]);
			}
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

	// Walrus reads and writes can fail transiently while storage nodes catch up;
	// retry a few times before declaring a step failed.
	async function okEventually(args: readonly string[]): Promise<RunResult> {
		const attempts = 4;
		const delayMs = 5_000;
		let last: RunResult | undefined;
		for (let i = 0; i < attempts; i += 1) {
			last = await run(args);
			if (last.code === 0) {
				return last;
			}
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
		throw new Error(
			`\`${args.join(" ")}\` still failing after ${attempts} attempts: ${last?.stderr}`,
		);
	}

	function parse<T>(res: RunResult): T {
		return JSON.parse(res.stdout) as T;
	}

	async function writeTemp(name: string, content: string): Promise<string> {
		const path = join(payloadDir, name);
		await writeFile(path, content);
		return path;
	}

	function requireEntry(): string {
		if (state.entryId === undefined) {
			throw new Error("Skipped: no entry id from the `entry add` step.");
		}
		return state.entryId;
	}

	test(
		"create publication",
		async () => {
			const res = await ok([
				"--json",
				"publication",
				"create",
				"--name",
				"E2E",
				"--slug",
				`e2e-${Date.now()}`,
			]);
			state.publicationCreated = true;
			expect(parse<{ publicationId: string }>(res).publicationId).toMatch(
				/^0x/,
			);
		},
		STEP_TIMEOUT_MS,
	);

	test(
		"create collection (selected as active)",
		async () => {
			await ok(["--json", "collection", "create", "posts", "--mode", "blob"]);
		},
		STEP_TIMEOUT_MS,
	);

	test(
		"add entry (Walrus upload)",
		async () => {
			const file = await writeTemp("post.txt", PAYLOAD);
			const res = await okEventually([
				"--json",
				"entry",
				"add",
				"first",
				"--file",
				file,
			]);
			state.entryId = String(parse<{ entryId: number }>(res).entryId);
		},
		STEP_TIMEOUT_MS,
	);

	test(
		"read entry back (Walrus round-trip)",
		async () => {
			const readOut = join(payloadDir, "read-back.txt");
			await okEventually([
				"entry",
				"read",
				requireEntry(),
				"--out",
				readOut,
				...READ_FLAGS,
			]);
			expect(await readFile(readOut, "utf8")).toBe(PAYLOAD);
		},
		STEP_TIMEOUT_MS,
	);

	test(
		"publish a revision",
		async () => {
			const revised = await writeTemp("post2.txt", REVISED);
			await okEventually([
				"--json",
				"revision",
				"publish-direct",
				requireEntry(),
				"--file",
				revised,
			]);
		},
		STEP_TIMEOUT_MS,
	);

	test(
		"entry now has two revisions",
		async () => {
			const res = await ok(["--json", "entry", "get", requireEntry()]);
			expect(parse<{ revisions: unknown[] }>(res).revisions.length).toBe(2);
		},
		STEP_TIMEOUT_MS,
	);

	test(
		"add encrypted entry (Seal + Walrus)",
		async () => {
			const secretFile = await writeTemp("secret.txt", SECRET);
			const res = await okEventually([
				"--json",
				"entry",
				"add-encrypted",
				"secret",
				"--file",
				secretFile,
			]);
			state.encryptedEntryId = String(parse<{ entryId: number }>(res).entryId);
		},
		STEP_TIMEOUT_MS,
	);

	test(
		"decrypt entry back (Seal round-trip)",
		async () => {
			if (state.encryptedEntryId === undefined) {
				throw new Error("Skipped: no entry id from the `add-encrypted` step.");
			}
			const decryptOut = join(payloadDir, "decrypted.txt");
			await okEventually([
				"entry",
				"decrypt",
				state.encryptedEntryId,
				"--out",
				decryptOut,
				...READ_FLAGS,
			]);
			expect(await readFile(decryptOut, "utf8")).toBe(SECRET);
		},
		STEP_TIMEOUT_MS,
	);
});
