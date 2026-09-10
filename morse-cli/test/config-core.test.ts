import { describe, expect, test } from "bun:test";

import {
	runConfigAdd,
	runConfigList,
	runConfigPath,
	runConfigRemove,
	runConfigUse,
} from "../src/commands/config.ts";
import { loadConfig } from "../src/config/store.ts";
import { useTempConfigHome } from "./support/config-home.ts";
import { captureOutput } from "./support/output.ts";

useTempConfigHome();

describe("runConfigPath", () => {
	test("prints a config.json path under the config dir", () => {
		const captured = captureOutput();
		runConfigPath(captured.output);
		expect(captured.stdout().trim()).toMatch(/morse[/\\]config\.json$/);
	});
});

describe("runConfigList", () => {
	test("reports an empty config", async () => {
		const captured = captureOutput();
		await runConfigList(captured.output);
		expect(captured.stdout()).toContain("No profiles configured");
	});

	test("lists profiles with their rpc override and marks the default", async () => {
		await runConfigAdd(captureOutput().output, "tnet", {
			network: "testnet",
			rpc: "https://rpc.example",
		});
		const captured = captureOutput();
		await runConfigList(captured.output);
		expect(captured.stdout()).toContain("* tnet");
		expect(captured.stdout()).toContain("https://rpc.example");
	});
});

describe("runConfigAdd", () => {
	test("saves a profile and makes the first one default", async () => {
		const captured = captureOutput();
		await runConfigAdd(captured.output, "tnet", { network: "testnet" });
		expect(captured.stdout()).toContain('Saved profile "tnet"');
		const cfg = await loadConfig();
		expect(cfg.profiles.tnet?.network).toBe("testnet");
		expect(cfg.defaultProfile).toBe("tnet");
	});

	test("rejects an unknown network", async () => {
		const captured = captureOutput();
		await expect(
			runConfigAdd(captured.output, "x", { network: "devnet" }),
		).rejects.toThrow(/network/i);
	});
});

describe("runConfigAdd upload relay", () => {
	test("persists uploadRelay and shows it in both output modes", async () => {
		// The human and JSON renderings of `config list` must agree; --json used
		// to surface uploadRelay while the human list silently omitted it, making
		// the flag look inert.
		const captured = captureOutput();
		await runConfigAdd(captured.output, "r", {
			network: "mainnet",
			uploadRelay: "auto",
		});
		const cfg = await loadConfig();
		expect(cfg.profiles.r?.uploadRelay).toBe("auto");

		const human = captureOutput();
		await runConfigList(human.output);
		expect(human.stdout()).toContain("relay=auto");

		const json = captureOutput({ json: true });
		await runConfigList(json.output);
		expect(JSON.stringify(json.json())).toContain("auto");
	});

	test("refuses auto on a network with no canonical relay", async () => {
		// Validated at add time, like network is, rather than storing a profile
		// that only fails the first time someone uploads.
		await expect(
			runConfigAdd(captureOutput().output, "bad", {
				network: "localnet",
				uploadRelay: "auto",
			}),
		).rejects.toThrow(/no canonical relay/);
	});

	test("an explicit relay URL is accepted on any network", async () => {
		await runConfigAdd(captureOutput().output, "x", {
			network: "localnet",
			uploadRelay: "https://relay.example",
		});
		const cfg = await loadConfig();
		expect(cfg.profiles.x?.uploadRelay).toBe("https://relay.example");
	});
});

describe("runConfigRemove confirmation", () => {
	test("refuses without --yes in a non-interactive context", async () => {
		// It deletes a profile plus its account, publication and collection
		// links, and can silently reassign the default. Every other destructive
		// command confirms; this one used to just do it.
		await runConfigAdd(captureOutput().output, "doomed", {
			network: "testnet",
		});
		await expect(
			runConfigRemove(captureOutput().output, "doomed"),
		).rejects.toThrow(/--yes|Cancelled/);
		const cfg = await loadConfig();
		expect(cfg.profiles.doomed).toBeDefined();
	});
});

describe("runConfigUse / runConfigRemove", () => {
	test("use rejects a missing profile", async () => {
		const captured = captureOutput();
		await expect(runConfigUse(captured.output, "ghost")).rejects.toThrow(
			/No profile named "ghost"/,
		);
	});

	test("use switches the default among existing profiles", async () => {
		await runConfigAdd(captureOutput().output, "a", { network: "testnet" });
		await runConfigAdd(captureOutput().output, "b", { network: "testnet" });
		const captured = captureOutput();
		await runConfigUse(captured.output, "b");
		expect(captured.stdout()).toContain('Default profile set to "b"');
		expect((await loadConfig()).defaultProfile).toBe("b");
	});

	test("removing the default profile reassigns the default", async () => {
		await runConfigAdd(captureOutput().output, "a", { network: "testnet" });
		await runConfigAdd(captureOutput().output, "b", { network: "testnet" });
		await runConfigRemove(captureOutput().output, "a", { yes: true }); // 'a' was the default
		const cfg = await loadConfig();
		expect(cfg.profiles.a).toBeUndefined();
		expect(cfg.defaultProfile).toBe("b");
	});

	test("remove deletes an existing profile", async () => {
		const add = captureOutput();
		await runConfigAdd(add.output, "tnet", { network: "testnet" });
		const captured = captureOutput();
		await runConfigRemove(captured.output, "tnet", { yes: true });
		expect(captured.stdout()).toContain('Removed profile "tnet"');
		expect((await loadConfig()).profiles.tnet).toBeUndefined();
	});
});
