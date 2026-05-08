import { describe, expect, test } from "bun:test";

import { toPackageId, toRegistryId } from "./codecs.js";
import { DEFAULT_RPC_URLS, morseConfig, Network } from "./config.js";
import { ConfigurationError } from "./errors.js";

describe("Network", () => {
	test("exposes exactly mainnet, testnet, and localnet", () => {
		const values = Object.values(Network);
		expect(values).toHaveLength(3);
		expect(values).toContain("mainnet");
		expect(values).toContain("testnet");
		expect(values).toContain("localnet");
	});

	test("values are the lowercase network names", () => {
		expect(Network.Mainnet).toBe("mainnet");
		expect(Network.Testnet).toBe("testnet");
		expect(Network.Localnet).toBe("localnet");
	});
});

describe("DEFAULT_RPC_URLS", () => {
	test("has an entry for every Network", () => {
		for (const network of Object.values(Network)) {
			expect(DEFAULT_RPC_URLS[network]).toBeDefined();
		}
	});

	test("mainnet and testnet use https, localnet uses http", () => {
		expect(DEFAULT_RPC_URLS.mainnet.startsWith("https://")).toBe(true);
		expect(DEFAULT_RPC_URLS.testnet.startsWith("https://")).toBe(true);
		expect(DEFAULT_RPC_URLS.localnet.startsWith("http://")).toBe(true);
	});

	test("urls are non-empty strings", () => {
		for (const url of Object.values(DEFAULT_RPC_URLS)) {
			expect(url.length).toBeGreaterThan(0);
		}
	});
});

describe("morseConfig", () => {
	test("returns a fully-populated config for testnet using canonical addresses", () => {
		const config = morseConfig({ network: "testnet" });
		expect(config.network).toBe("testnet");
		expect(config.rpcUrl).toBe(DEFAULT_RPC_URLS.testnet);
		expect(config.packageId as string).toMatch(/^0x[0-9a-f]{1,64}$/);
		expect(config.registryId as string).toMatch(/^0x[0-9a-f]{1,64}$/);
		expect(config.originalPackageId).toBeDefined();
	});

	test("respects rpcUrl override", () => {
		const config = morseConfig({
			network: "testnet",
			rpcUrl: "https://custom-rpc.example",
		});
		expect(config.rpcUrl).toBe("https://custom-rpc.example");
	});

	test("respects per-address overrides for forks", () => {
		const customPackage = toPackageId(
			"0x000000000000000000000000000000000000000000000000000000000000aaaa",
		);
		const customRegistry = toRegistryId(
			"0x000000000000000000000000000000000000000000000000000000000000bbbb",
		);
		const config = morseConfig({
			network: "testnet",
			packageId: customPackage,
			registryId: customRegistry,
		});
		expect(config.packageId).toBe(customPackage);
		expect(config.registryId).toBe(customRegistry);
	});

	test("throws ConfigurationError for mainnet with a specific message", () => {
		try {
			morseConfig({ network: "mainnet" });
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(ConfigurationError);
			expect((error as ConfigurationError).message).toContain("mainnet");
		}
	});

	test("throws ConfigurationError for localnet without overrides", () => {
		expect(() => morseConfig({ network: "localnet" })).toThrow(
			ConfigurationError,
		);
	});

	test("accepts localnet when packageId and registryId overrides are supplied", () => {
		const localPackage = toPackageId(
			"0x000000000000000000000000000000000000000000000000000000000000eeee",
		);
		const localRegistry = toRegistryId(
			"0x000000000000000000000000000000000000000000000000000000000000ffff",
		);
		const config = morseConfig({
			network: "localnet",
			packageId: localPackage,
			registryId: localRegistry,
		});
		expect(config.network).toBe("localnet");
		expect(config.packageId).toBe(localPackage);
		expect(config.registryId).toBe(localRegistry);
	});

	test("partial override on testnet keeps unspecified fields from the canonical deployment", () => {
		const customPackage = toPackageId(
			"0x000000000000000000000000000000000000000000000000000000000000abcd",
		);
		const config = morseConfig({
			network: "testnet",
			packageId: customPackage,
		});
		expect(config.packageId).toBe(customPackage);
		// originalPackageId and registryId should fall through to the canonical
		// testnet deployment, not be undefined.
		expect(config.originalPackageId).toBeDefined();
		expect(config.registryId).toBeDefined();
		expect(config.rpcUrl).toBe("https://fullnode.testnet.sui.io:443");
	});

	test("testnet config carries the canonical Seal key-server allowlist", () => {
		const config = morseConfig({ network: "testnet" });
		expect(config.sealKeyServers.length).toBeGreaterThan(0);
		for (const server of config.sealKeyServers) {
			expect(typeof server.objectId).toBe("string");
			expect(server.objectId.startsWith("0x")).toBe(true);
			expect(server.weight).toBeGreaterThan(0);
		}
	});

	test("sealKeyServers can be overridden", () => {
		const custom = [{ objectId: "0xabc", weight: 1 }];
		const config = morseConfig({
			network: "testnet",
			sealKeyServers: custom,
		});
		expect(config.sealKeyServers).toBe(custom);
	});
});
