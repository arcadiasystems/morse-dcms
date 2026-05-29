import { describe, expect, test } from "bun:test";

import { resolveSettings } from "../src/config/profile.ts";
import {
	type Config,
	coerceNetwork,
	emptyConfig,
	parseConfig,
} from "../src/config/schema.ts";

describe("parseConfig", () => {
	test("accepts a valid config", () => {
		const cfg = parseConfig(
			{
				version: 1,
				defaultProfile: "t",
				profiles: { t: { network: "testnet", rpc: "https://x" } },
			},
			"test",
		);
		expect(cfg.defaultProfile).toBe("t");
		expect(cfg.profiles.t?.network).toBe("testnet");
		expect(cfg.profiles.t?.rpc).toBe("https://x");
	});

	test("rejects an invalid network", () => {
		expect(() =>
			parseConfig(
				{ defaultProfile: "t", profiles: { t: { network: "devnet" } } },
				"test",
			),
		).toThrow();
	});

	test("rejects a non-object", () => {
		expect(() => parseConfig("nope", "test")).toThrow();
	});
});

describe("coerceNetwork", () => {
	test("accepts a known network", () => {
		expect(coerceNetwork("testnet")).toBe("testnet");
	});

	test("rejects an unknown network", () => {
		expect(() => coerceNetwork("devnet")).toThrow();
	});
});

describe("resolveSettings precedence", () => {
	const config: Config = {
		version: 1,
		defaultProfile: "main",
		profiles: { main: { network: "testnet", rpc: "https://profile" } },
	};

	test("flag beats env beats profile", () => {
		const resolved = resolveSettings(
			{ network: "localnet", rpc: "https://flag" },
			config,
			{ MORSE_NETWORK: "testnet", MORSE_RPC_URL: "https://env" },
		);
		expect(resolved.network).toBe("localnet");
		expect(resolved.rpcUrl).toBe("https://flag");
	});

	test("env beats profile when no flag is given", () => {
		const resolved = resolveSettings({}, config, {
			MORSE_RPC_URL: "https://env",
		});
		expect(resolved.rpcUrl).toBe("https://env");
		expect(resolved.network).toBe("testnet");
	});

	test("profile is used when no flag or env is given", () => {
		const resolved = resolveSettings({}, config, {});
		expect(resolved.rpcUrl).toBe("https://profile");
		expect(resolved.profileName).toBe("main");
	});

	test("falls back to defaults when no profile exists", () => {
		const resolved = resolveSettings({}, emptyConfig(), {});
		expect(resolved.network).toBe("testnet");
		expect(resolved.rpcUrl).toBeUndefined();
	});

	test("account comes from MORSE_ADDRESS, then the profile", () => {
		const fromEnv = resolveSettings({}, config, { MORSE_ADDRESS: "0xabc" });
		expect(fromEnv.account).toBe("0xabc");
		const withAccountProfile: Config = {
			version: 1,
			defaultProfile: "main",
			profiles: { main: { network: "testnet", account: "0xdef" } },
		};
		expect(resolveSettings({}, withAccountProfile, {}).account).toBe("0xdef");
	});

	test("an explicitly named missing profile throws", () => {
		expect(() =>
			resolveSettings({ profile: "ghost" }, emptyConfig(), {}),
		).toThrow();
	});
});
