/**
 * Live testnet lifecycle for the allowlist + file surface, through the built
 * bundle. Opt-in: runs only when MORSE_E2E=1, so the default gate never touches
 * the network. Set MORSE_E2E_AGGREGATOR=1 to route the download reads through
 * the Walrus aggregator. Requires a funded testnet key (MORSE_PRIVATE_KEY or
 * .env.testnet) with SUI for gas and WAL for the uploads. Run: bun run test:e2e
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import {
	ensureDist,
	makeConfigDir,
	type RunResult,
	removeConfigDir,
	runDist,
} from "../support/cli.ts";

const RUN = process.env.MORSE_E2E === "1";
const READ_FLAGS =
	process.env.MORSE_E2E_AGGREGATOR === "1" ? ["--via-aggregator"] : [];
const STEP_TIMEOUT_MS = 120_000;
const ENV_FILE = new URL("../../.env.testnet", import.meta.url).pathname;
const SECRET_TEXT = "files e2e secret payload";
const PUBLIC_TEXT = "files e2e public payload";

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

describe.if(RUN)("live testnet files lifecycle (MORSE_E2E=1)", () => {
	let configDir: string;
	let payloadDir: string;
	let env: Record<string, string>;
	let self: string;
	const state: {
		allowlistId?: string;
		sealId?: string;
		encryptedFileId?: string;
		publicFileId?: string;
	} = {};

	beforeAll(async () => {
		await ensureDist();
		const key = await loadPrivateKey();
		self = Ed25519Keypair.fromSecretKey(key).toSuiAddress();
		env = { MORSE_PRIVATE_KEY: key, MORSE_NETWORK: "testnet" };
		configDir = await makeConfigDir("morse-e2e-files-");
		payloadDir = await mkdtemp(join(tmpdir(), "morse-e2e-files-data-"));
	});

	afterAll(async () => {
		if (env !== undefined) {
			if (state.encryptedFileId !== undefined) {
				await run(["file", "delete", state.encryptedFileId, "-y"]);
			}
			if (state.publicFileId !== undefined) {
				await run(["file", "delete", state.publicFileId, "-y"]);
			}
			if (state.allowlistId !== undefined) {
				await run(["allowlist", "delete", "-a", state.allowlistId, "-y"]);
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

	async function okEventually(args: readonly string[]): Promise<RunResult> {
		const attempts = 4;
		let last: RunResult | undefined;
		for (let i = 0; i < attempts; i += 1) {
			last = await run(args);
			if (last.code === 0) {
				return last;
			}
			await new Promise((resolve) => setTimeout(resolve, 5_000));
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

	test(
		"create allowlist and add self as a member",
		async () => {
			const created = parse<{ allowlistId: string }>(
				await ok(["--json", "allowlist", "create", "--name", "e2e-files"]),
			);
			state.allowlistId = created.allowlistId;
			await ok([
				"--json",
				"allowlist",
				"add-member",
				self,
				"-a",
				created.allowlistId,
			]);
			const got = parse<{ members: string[] }>(
				await ok(["--json", "allowlist", "get", created.allowlistId]),
			);
			expect(got.members).toContain(self);
		},
		STEP_TIMEOUT_MS,
	);

	test(
		"upload and decrypt an encrypted file",
		async () => {
			if (state.allowlistId === undefined) {
				throw new Error("Skipped: no allowlist from the previous step.");
			}
			const file = await writeTemp("secret.txt", SECRET_TEXT);
			const uploaded = parse<{ fileId: string; sealId: string }>(
				await okEventually([
					"--json",
					"file",
					"upload",
					file,
					"--name",
					"secret.txt",
					"-a",
					state.allowlistId,
				]),
			);
			state.encryptedFileId = uploaded.fileId;
			state.sealId = uploaded.sealId;
			const out = join(payloadDir, "decrypted.txt");
			await okEventually([
				"file",
				"download",
				uploaded.fileId,
				"--seal-id",
				uploaded.sealId,
				"--out",
				out,
				...READ_FLAGS,
			]);
			expect(await readFile(out, "utf8")).toBe(SECRET_TEXT);
		},
		STEP_TIMEOUT_MS * 2,
	);

	test(
		"upload and read back a public file",
		async () => {
			const file = await writeTemp("public.txt", PUBLIC_TEXT);
			const uploaded = parse<{ fileId: string }>(
				await okEventually([
					"--json",
					"file",
					"upload",
					file,
					"--name",
					"public.txt",
					"--public",
				]),
			);
			state.publicFileId = uploaded.fileId;
			const out = join(payloadDir, "public-read.txt");
			await okEventually([
				"file",
				"download",
				uploaded.fileId,
				"--out",
				out,
				...READ_FLAGS,
			]);
			expect(await readFile(out, "utf8")).toBe(PUBLIC_TEXT);
		},
		STEP_TIMEOUT_MS * 2,
	);
});
