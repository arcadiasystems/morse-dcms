import { describe, expect, test } from "bun:test";

import { toPackageId, toRegistryId } from "./codecs.js";
import {
	DEFAULT_RPC_URLS,
	MAINNET_SEAL_COMMITTEE,
	morseConfig,
	Network,
} from "./config.js";
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

	test("returns a fully-populated config for mainnet using canonical addresses", () => {
		const config = morseConfig({ network: "mainnet" });
		expect(config.network).toBe("mainnet");
		expect(config.rpcUrl).toBe(DEFAULT_RPC_URLS.mainnet);
		expect(config.packageId).toBe(
			toPackageId(
				"0x4fc7af5d1e19f96e5fab4e677948214eec35e238b252a106c7d5036dcebdcae2",
			),
		);
		expect(config.registryId).toBe(
			toRegistryId(
				"0x8d8b23c7acd7c1b260c793f2c648c5be8eb06db7c107b9f06ca3f39b700868ea",
			),
		);
		expect(config.walrusEndpoints.aggregator).toBe(
			"https://aggregator.walrus-mainnet.walrus.space",
		);
		expect(config.walrusEndpoints.publisher).toBeUndefined();
	});

	test("mainnet is an unupgraded publish, so all three package ids coincide", () => {
		// Not a tautology worth deleting: the day mainnet is upgraded, packageId
		// moves and these must diverge. This test failing is the signal that the
		// entry was half-updated.
		const config = morseConfig({ network: "mainnet" });
		expect(config.originalPackageId).toBe(config.packageId);
		expect(config.recipientFileEventOriginPackageId).toBe(config.packageId);
	});

	test("rejects an unrecognised network as a typo, not a custom deployment", () => {
		// The missing-deployment error tells the caller to supply a packageId,
		// which is wrong advice for a misspelling. Typed callers are protected by
		// the Network union; JS callers and env-sourced values are not.
		expect(() =>
			morseConfig({ network: "mainet" as unknown as Network }),
		).toThrow(/Unknown network "mainet"/);
		expect(() => morseConfig({ network: "" as unknown as Network })).toThrow(
			/Unknown network/,
		);
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

	test("mainnet ships no Seal key servers", () => {
		// Every mainnet operator is commercial. 0.5.0 defaulted this to Mysten's
		// committee, whose aggregator 401s without an API key; because Seal reads
		// public keys from chain but shares from the aggregator, encryption
		// succeeded and only decryption failed, so a consumer could produce
		// ciphertext they could never read. Empty makes it fail at construction.
		const config = morseConfig({ network: "mainnet" });
		expect(config.sealKeyServers).toEqual([]);
	});

	test("MAINNET_SEAL_COMMITTEE is committee-shaped and carries no credentials", () => {
		// Opt-in value, not a default. aggregatorUrl is mandatory for a
		// committee-mode server (Seal throws InvalidClientOptionsError without
		// it); the API key is the consumer's to add.
		expect(MAINNET_SEAL_COMMITTEE).toHaveLength(1);
		const committee = MAINNET_SEAL_COMMITTEE[0];
		expect(committee?.objectId).toBe(
			"0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595",
		);
		expect(committee?.weight).toBe(1);
		expect(committee?.aggregatorUrl).toBe(
			"https://seal-aggregator-mainnet.mystenlabs.com",
		);
		expect(committee?.apiKey).toBeUndefined();
		expect(committee?.apiKeyName).toBeUndefined();
	});

	test("MAINNET_SEAL_COMMITTEE can be passed straight back in as an override", () => {
		const config = morseConfig({
			network: "mainnet",
			sealKeyServers: MAINNET_SEAL_COMMITTEE,
		});
		expect(config.sealKeyServers).toBe(MAINNET_SEAL_COMMITTEE);
	});

	test("testnet Seal allowlist carries no aggregatorUrl", () => {
		// The mirror image of the check above: Seal rejects an INDEPENDENT server
		// that has aggregatorUrl set, with the same error class. Testnet's two
		// servers are independent, so the field must stay absent.
		const config = morseConfig({ network: "testnet" });
		expect(config.sealKeyServers.length).toBeGreaterThan(0);
		for (const server of config.sealKeyServers) {
			expect(server.aggregatorUrl).toBeUndefined();
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
