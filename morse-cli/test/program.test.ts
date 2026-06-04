/**
 * In-process dispatch through the assembled program. Each case routes a real
 * argv through commander into a command wrapper, exercising registration, the
 * global-option plumbing, and the context builders (cli/context.ts) up to the
 * first guard that throws. Every case is chosen to fail before any RPC: missing
 * target, declined confirmation in a non-TTY, missing content, a localnet guard,
 * or a bad flag. Process IO is swallowed so the assembled commands' output does
 * not leak into the test report.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { buildProgram } from "../src/cli/program.ts";
import { registerCommands } from "../src/commands/index.ts";
import { useTempConfigHome } from "./support/config-home.ts";

useTempConfigHome();

const ID = `0x${"1".repeat(64)}`;
const CAP = `0x${"d".repeat(64)}`;
const RECIPIENT = `0x${"2".repeat(64)}`;
const SECRET = Ed25519Keypair.generate().getSecretKey();

const savedKey = process.env.MORSE_PRIVATE_KEY;
const savedPw = process.env.MORSE_KEYSTORE_PASSWORD;

beforeEach(() => {
	// A raw key makes the write/content/encrypt contexts build offline; no
	// keystore password, so account import fails at the password step.
	process.env.MORSE_PRIVATE_KEY = SECRET;
	delete process.env.MORSE_KEYSTORE_PASSWORD;
});

afterEach(() => {
	restore("MORSE_PRIVATE_KEY", savedKey);
	restore("MORSE_KEYSTORE_PASSWORD", savedPw);
});

function restore(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

// Swallows the assembled command's stdout/stderr around a single parse. This
// mutates the global streams, so it relies on Bun running tests in a file
// sequentially (the default); do not run this file with --concurrent.
async function dispatch(args: string[]): Promise<void> {
	const program = buildProgram();
	registerCommands(program);
	const outWrite = process.stdout.write.bind(process.stdout);
	const errWrite = process.stderr.write.bind(process.stderr);
	const swallow = (): boolean => true;
	(process.stdout as { write: unknown }).write = swallow;
	(process.stderr as { write: unknown }).write = swallow;
	try {
		await program.parseAsync(args, { from: "user" });
	} finally {
		(process.stdout as { write: unknown }).write = outWrite;
		(process.stderr as { write: unknown }).write = errWrite;
	}
}

describe("registration", () => {
	test("every command group is registered on the program", () => {
		const program = buildProgram();
		registerCommands(program);
		const names = program.commands.map((c) => c.name()).sort();
		expect(names).toEqual(
			[
				"account",
				"cap",
				"collection",
				"config",
				"entry",
				"file",
				"publication",
				"revision",
				"status",
				"use",
			].sort(),
		);
	});
});

describe("read contexts build and guard before any RPC", () => {
	test("publication get with no target", async () => {
		await expect(dispatch(["publication", "get"])).rejects.toThrow(
			/No publication selected/,
		);
	});

	test("publication list rejects a malformed address before any RPC", async () => {
		await expect(
			dispatch(["publication", "list", "not-an-address"]),
		).rejects.toThrow();
	});

	test("collection list with no target", async () => {
		await expect(dispatch(["collection", "list"])).rejects.toThrow(
			/No publication selected/,
		);
	});

	test("cap list rejects a malformed address before any RPC", async () => {
		await expect(dispatch(["cap", "list", "not-an-address"])).rejects.toThrow();
	});

	test("entry read in --json without --out", async () => {
		await expect(
			dispatch(["--json", "entry", "read", "0", "-P", ID, "-C", "blog"]),
		).rejects.toThrow(/--out/);
	});
});

describe("write contexts build offline and guard", () => {
	test("publication delete declines without --yes", async () => {
		await expect(dispatch(["publication", "delete", ID])).rejects.toThrow(
			/--yes/,
		);
	});

	test("transfer-ownership declines without --yes", async () => {
		await expect(
			dispatch(["publication", "transfer-ownership", RECIPIENT, "-P", ID]),
		).rejects.toThrow(/--yes/);
	});

	test("collection create rejects a bad --mode", async () => {
		await expect(
			dispatch(["collection", "create", "blog", "-P", ID, "--mode", "bogus"]),
		).rejects.toThrow(/--mode/);
	});

	test("cap issue rejects a malformed holder", async () => {
		await expect(
			dispatch(["cap", "issue", "not-an-address", "-P", ID]),
		).rejects.toThrow();
	});

	test("cap revoke declines without --yes", async () => {
		await expect(dispatch(["cap", "revoke", CAP, "-P", ID])).rejects.toThrow(
			/--yes/,
		);
	});

	test("cap destroy declines without --yes", async () => {
		await expect(dispatch(["cap", "destroy", CAP, "-P", ID])).rejects.toThrow(
			/--yes/,
		);
	});

	test("cap transfer declines without --yes", async () => {
		await expect(dispatch(["cap", "transfer", CAP, RECIPIENT])).rejects.toThrow(
			/--yes/,
		);
	});
});

describe("content/encrypt contexts build offline and guard", () => {
	test("entry add with no content source", async () => {
		await expect(
			dispatch(["entry", "add", "post", "-P", ID, "-C", "blog"]),
		).rejects.toThrow(/--file|content/);
	});

	test("revision publish-direct with no content source", async () => {
		await expect(
			dispatch(["revision", "publish-direct", "0", "-P", ID, "-C", "blog"]),
		).rejects.toThrow(/--file|content/);
	});

	test("entry add-encrypted with no content source", async () => {
		await expect(
			dispatch(["entry", "add-encrypted", "post", "-P", ID, "-C", "blog"]),
		).rejects.toThrow(/--file|content/);
	});

	test("entry decrypt in --json without --out", async () => {
		await expect(
			dispatch(["--json", "entry", "decrypt", "0", "-P", ID, "-C", "blog"]),
		).rejects.toThrow(/--out/);
	});

	test("entry read --via-aggregator builds the aggregator adapter", async () => {
		// Reaches the read-content context with the aggregator branch, then trips
		// the same json-without-out guard before any fetch.
		await expect(
			dispatch([
				"--json",
				"entry",
				"read",
				"0",
				"-P",
				ID,
				"-C",
				"blog",
				"--via-aggregator",
			]),
		).rejects.toThrow(/--out/);
	});

	test("entry decrypt --via-aggregator builds the aggregator adapter", async () => {
		await expect(
			dispatch([
				"--json",
				"entry",
				"decrypt",
				"0",
				"-P",
				ID,
				"-C",
				"blog",
				"--via-aggregator",
			]),
		).rejects.toThrow(/--out/);
	});
});

describe("localnet guards on content contexts", () => {
	test("entry add is refused on localnet", async () => {
		await expect(
			dispatch([
				"--network",
				"localnet",
				"entry",
				"add",
				"post",
				"-P",
				ID,
				"-C",
				"blog",
				"--stdin",
			]),
		).rejects.toThrow(/localnet/);
	});

	test("entry read is refused on localnet", async () => {
		await expect(
			dispatch([
				"--network",
				"localnet",
				"entry",
				"read",
				"0",
				"-P",
				ID,
				"-C",
				"blog",
				"--out",
				join(tmpdir(), "morse-localnet-out"),
			]),
		).rejects.toThrow(/localnet/);
	});

	test("entry decrypt is refused on localnet", async () => {
		await expect(
			dispatch([
				"--network",
				"localnet",
				"entry",
				"decrypt",
				"0",
				"-P",
				ID,
				"-C",
				"blog",
				"--out",
				join(tmpdir(), "morse-localnet-dec"),
			]),
		).rejects.toThrow(/localnet/);
	});
});

describe("file wrappers (offline guards)", () => {
	const FILE = `0x${"9".repeat(64)}`;

	test("upload requires --public, --encrypt, or --recipient", async () => {
		await expect(
			dispatch(["file", "upload", "/tmp/x", "--name", "x"]),
		).rejects.toThrow(/--public|--encrypt/);
	});

	test("get rejects a malformed file id before any RPC", async () => {
		await expect(dispatch(["file", "get", "not-an-id"])).rejects.toThrow();
	});

	test("list rejects a malformed --address before any RPC", async () => {
		await expect(
			dispatch(["file", "list", "--address", "not-an-address"]),
		).rejects.toThrow();
	});

	test("download in --json without --out is a usage error", async () => {
		await expect(
			dispatch(["--json", "file", "download", FILE]),
		).rejects.toThrow(/--out/);
	});

	test("download --via-aggregator builds the aggregator adapter", async () => {
		await expect(
			dispatch(["--json", "file", "download", FILE, "--via-aggregator"]),
		).rejects.toThrow(/--out/);
	});

	test("download is refused on localnet", async () => {
		await expect(
			dispatch([
				"--network",
				"localnet",
				"file",
				"download",
				FILE,
				"--out",
				join(tmpdir(), "morse-file-localnet"),
			]),
		).rejects.toThrow(/localnet/);
	});

	test("update rejects a malformed file id before any RPC", async () => {
		await expect(
			dispatch([
				"file",
				"update",
				"not-an-id",
				"--name",
				"x",
				"--content-type",
				"text/plain",
			]),
		).rejects.toThrow();
	});

	test("register requires --public or --encrypted", async () => {
		await expect(
			dispatch([
				"file",
				"register",
				"--blob-id",
				"A".repeat(43),
				"--name",
				"x",
				"--content-type",
				"text/plain",
				"--size",
				"10",
			]),
		).rejects.toThrow(/--public|--encrypted/);
	});

	test("transfer-ownership declines without --yes", async () => {
		await expect(
			dispatch(["file", "transfer-ownership", FILE, RECIPIENT]),
		).rejects.toThrow(/--yes/);
	});

	test("delete declines without --yes", async () => {
		await expect(dispatch(["file", "delete", FILE])).rejects.toThrow(/--yes/);
	});

	test("recipient add rejects a malformed file id before any RPC", async () => {
		await expect(
			dispatch(["file", "recipient", "add", "not-an-id", RECIPIENT]),
		).rejects.toThrow();
	});

	test("recipient remove rejects a malformed address before any RPC", async () => {
		await expect(
			dispatch(["file", "recipient", "remove", FILE, "not-an-address"]),
		).rejects.toThrow();
	});

	test("recipient list rejects a malformed file id before any RPC", async () => {
		await expect(
			dispatch(["file", "recipient", "list", "not-an-id"]),
		).rejects.toThrow();
	});
});

describe("account and config wrappers", () => {
	test("account show resolves the address derived from MORSE_PRIVATE_KEY", async () => {
		// With a raw key set, the active account is the key's address, so the
		// wrapper renders it instead of erroring.
		await expect(dispatch(["account", "show"])).resolves.toBeUndefined();
	});

	test("account import fails at the password step with no password set", async () => {
		await expect(dispatch(["account", "import"])).rejects.toThrow();
	});

	test("config add rejects an unknown network", async () => {
		await expect(
			dispatch(["config", "add", "x", "--network", "devnet"]),
		).rejects.toThrow(/network/i);
	});

	test("config use rejects a missing profile", async () => {
		await expect(dispatch(["config", "use", "ghost"])).rejects.toThrow(
			/No profile named/,
		);
	});

	test("use with no publication and no --clear", async () => {
		await expect(dispatch(["use"])).rejects.toThrow(/Provide a publication/);
	});
});
