import { describe, expect, test } from "bun:test";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import {
	runAccountExport,
	runAccountImport,
	runAccountList,
	runAccountShow,
	runAccountUse,
} from "../src/commands/account.ts";
import { useTempConfigHome } from "./support/config-home.ts";
import { captureOutput } from "./support/output.ts";

useTempConfigHome();

const SIGNAL = new AbortController().signal;

function freshKey(): { secret: string; address: string } {
	const secret = Ed25519Keypair.generate().getSecretKey();
	return {
		secret,
		address: Ed25519Keypair.fromSecretKey(secret).toSuiAddress(),
	};
}

describe("runAccountList", () => {
	test("reports no accounts on a fresh config", async () => {
		const captured = captureOutput();
		await runAccountList(captured.output, {});
		expect(captured.stdout()).toContain("No accounts");
	});
});

describe("runAccountImport then list/show", () => {
	test("imports from env and marks the account active", async () => {
		const { secret, address } = freshKey();
		const env = {
			MORSE_PRIVATE_KEY: secret,
			MORSE_KEYSTORE_PASSWORD: "pw-123456",
		};
		const imported = captureOutput();
		await runAccountImport(imported.output, {}, env, SIGNAL);
		expect(imported.stdout()).toContain(address);

		const listed = captureOutput();
		await runAccountList(listed.output, {});
		expect(listed.stdout()).toContain(`* ${address}`);

		const shown = captureOutput();
		await runAccountShow(shown.output, {});
		expect(shown.stdout().trim()).toBe(address);
	});
});

describe("runAccountShow", () => {
	test("errors when there is no active account", async () => {
		const captured = captureOutput();
		await expect(runAccountShow(captured.output, {})).rejects.toThrow(
			/No active account/,
		);
	});
});

describe("runAccountUse", () => {
	test("rejects an address with no keystore", async () => {
		const { address } = freshKey();
		const captured = captureOutput();
		await expect(runAccountUse(captured.output, {}, address)).rejects.toThrow(
			/No keystore/,
		);
	});
});

describe("runAccountExport guards", () => {
	test("refuses in --json mode", async () => {
		const { address } = freshKey();
		const captured = captureOutput({ json: true });
		await expect(
			runAccountExport(captured.output, {}, address, {}, SIGNAL),
		).rejects.toThrow(/--json/);
	});

	test("refuses in a non-interactive context", async () => {
		const { address } = freshKey();
		const captured = captureOutput();
		await expect(
			runAccountExport(captured.output, {}, address, {}, SIGNAL),
		).rejects.toThrow(/interactive terminal/);
	});
});
