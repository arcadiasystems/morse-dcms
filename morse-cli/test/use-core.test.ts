import { describe, expect, test } from "bun:test";

import { runStatus, runUse } from "../src/commands/use.ts";
import type { ResolvedSettings } from "../src/config/profile.ts";
import { loadConfig } from "../src/config/store.ts";
import { useTempConfigHome } from "./support/config-home.ts";
import { readContext } from "./support/context.ts";
import { captureOutput } from "./support/output.ts";

useTempConfigHome();

const ID = `0x${"1".repeat(64)}`;

function neverContext(): never {
	throw new Error("makeContext should not be called");
}

describe("runUse", () => {
	test("--clear wipes the active publication and collection without building a client", async () => {
		const captured = captureOutput();
		await runUse(
			captured.output,
			{},
			undefined,
			undefined,
			{ clear: true },
			neverContext,
		);
		expect(captured.stdout()).toContain("Cleared the active publication");
		const cfg = await loadConfig();
		expect(cfg.profiles.default?.publication).toBeUndefined();
	});

	test("requires a publication when not clearing", async () => {
		const captured = captureOutput();
		await expect(
			runUse(captured.output, {}, undefined, undefined, {}, neverContext),
		).rejects.toThrow(/Provide a publication/);
	});

	test("selects a publication by id", async () => {
		const captured = captureOutput();
		const { ctx } = readContext();
		await runUse(captured.output, {}, ID, undefined, {}, () =>
			Promise.resolve(ctx),
		);
		expect(captured.stdout()).toContain(`Active publication set to ${ID}`);
		const cfg = await loadConfig();
		expect(cfg.profiles.default?.publication).toBe(ID);
	});

	test("selects a publication and a valid collection", async () => {
		const captured = captureOutput();
		const { ctx } = readContext({
			reader: {
				getPublication: () =>
					Promise.resolve({
						id: ID,
						slug: "s",
						name: "n",
						collections: [
							{ name: "posts", storageMode: "blob", nextEntryId: 0 },
						],
					}),
			} as never,
		});
		await runUse(captured.output, {}, ID, "posts", {}, () =>
			Promise.resolve(ctx),
		);
		expect(captured.stdout()).toContain('collection "posts"');
		const cfg = await loadConfig();
		expect(cfg.profiles.default?.collection).toBe("posts");
	});

	test("rejects a collection the publication does not have", async () => {
		const captured = captureOutput();
		const { ctx } = readContext({
			reader: {
				getPublication: () =>
					Promise.resolve({ id: ID, slug: "s", name: "n", collections: [] }),
			} as never,
		});
		await expect(
			runUse(captured.output, {}, ID, "ghost", {}, () => Promise.resolve(ctx)),
		).rejects.toThrow(/no collection "ghost"/);
	});
});

describe("runStatus", () => {
	const settings: ResolvedSettings = {
		profileName: "default",
		network: "testnet",
		publication: ID,
		collection: "posts",
	};

	test("renders the active context", () => {
		const captured = captureOutput();
		runStatus(captured.output, settings);
		expect(captured.stdout()).toContain("network:     testnet");
		expect(captured.stdout()).toContain(`publication: ${ID}`);
		expect(captured.stdout()).toContain("account:     (none)");
	});

	test("--json emits a structured object", () => {
		const captured = captureOutput({ json: true });
		runStatus(captured.output, settings);
		expect(captured.json()).toMatchObject({
			network: "testnet",
			publication: ID,
			collection: "posts",
			account: null,
		});
	});
});
