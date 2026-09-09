import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_TIP_MIST } from "../src/cli/program.ts";
import {
	parseMaxTip,
	resolveSettings,
	resolveUploadRelay,
} from "../src/config/profile.ts";
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

	test("accepts mainnet", () => {
		// Was rejected outright until the contracts shipped on mainnet.
		expect(coerceNetwork("mainnet")).toBe("mainnet");
	});

	test("accepts localnet, which morseConfig rejects later without overrides", () => {
		expect(coerceNetwork("localnet")).toBe("localnet");
	});

	test("rejects an unknown network", () => {
		expect(() => coerceNetwork("devnet")).toThrow();
	});
});

describe("resolveUploadRelay", () => {
	test("absent stays absent", () => {
		expect(resolveUploadRelay(undefined, "mainnet")).toBeUndefined();
		expect(resolveUploadRelay("", "mainnet")).toBeUndefined();
	});

	test("auto resolves to the canonical relay for the network", () => {
		expect(resolveUploadRelay("auto", "mainnet")).toBe(
			"https://upload-relay.mainnet.walrus.space",
		);
		expect(resolveUploadRelay("auto", "testnet")).toBe(
			"https://upload-relay.testnet.walrus.space",
		);
	});

	test("auto is refused on localnet, which has no canonical relay", () => {
		expect(() => resolveUploadRelay("auto", "localnet")).toThrow(
			/no canonical relay/,
		);
	});

	test("an explicit URL passes through untouched", () => {
		expect(resolveUploadRelay("https://relay.example", "mainnet")).toBe(
			"https://relay.example",
		);
	});
});

describe("upload relay setting", () => {
	const empty = { version: 1, defaultProfile: "d", profiles: {} };

	test("absent by default", () => {
		expect(resolveSettings({}, empty, {}).uploadRelay).toBeUndefined();
	});

	test("is carried raw, so reads never resolve or validate it", () => {
		// resolveSettings runs for every command. Resolving "auto" here would let
		// a stray MORSE_WALRUS_UPLOAD_RELAY break read commands on localnet.
		expect(
			resolveSettings({ uploadRelay: "auto", network: "localnet" }, empty, {})
				.uploadRelay,
		).toBe("auto");
	});

	test("flag beats env beats profile", () => {
		const cfg = {
			version: 1,
			defaultProfile: "d",
			profiles: {
				d: { network: "testnet" as const, uploadRelay: "https://from-profile" },
			},
		};
		expect(resolveSettings({}, cfg, {}).uploadRelay).toBe(
			"https://from-profile",
		);
		expect(
			resolveSettings({}, cfg, {
				MORSE_WALRUS_UPLOAD_RELAY: "https://from-env",
			}).uploadRelay,
		).toBe("https://from-env");
		expect(
			resolveSettings({ uploadRelay: "https://from-flag" }, cfg, {
				MORSE_WALRUS_UPLOAD_RELAY: "https://from-env",
			}).uploadRelay,
		).toBe("https://from-flag");
	});
});

describe("parseMaxTip", () => {
	test("defaults when unset", () => {
		expect(parseMaxTip(undefined)).toBe(DEFAULT_MAX_TIP_MIST);
		expect(parseMaxTip("")).toBe(DEFAULT_MAX_TIP_MIST);
	});

	test("accepts a plain integer", () => {
		expect(parseMaxTip("5")).toBe(5);
		expect(parseMaxTip("0")).toBe(0);
	});

	test("rejects anything that is not plain digits", () => {
		// A bad cap must not silently fall back to the default: that would let a
		// typo authorise an unbounded tip. Exponential and hex spellings are
		// rejected too, since nobody writes a MIST amount that way.
		for (const bad of ["abc", "-1", "1.5", "1e7", "0x10", " 5"]) {
			expect(() => parseMaxTip(bad)).toThrow(/non-negative integer/);
		}
	});
});

describe("max tip setting", () => {
	const empty = { version: 1, defaultProfile: "d", profiles: {} };

	test("is carried raw, so a bad value cannot break read commands", () => {
		// The cap only means anything to a Walrus upload. Parsing it in
		// resolveSettings would make a typo'd MORSE_WALRUS_MAX_TIP in a CI env
		// fail every command, including ones that never upload.
		expect(resolveSettings({ maxTip: "abc" }, empty, {}).maxTip).toBe("abc");
	});

	test("flag beats env", () => {
		expect(resolveSettings({ maxTip: "5" }, empty, {}).maxTip).toBe("5");
		expect(
			resolveSettings({}, empty, { MORSE_WALRUS_MAX_TIP: "7" }).maxTip,
		).toBe("7");
		expect(
			resolveSettings({ maxTip: "5" }, empty, { MORSE_WALRUS_MAX_TIP: "7" })
				.maxTip,
		).toBe("5");
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
