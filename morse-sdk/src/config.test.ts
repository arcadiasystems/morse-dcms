import { describe, expect, test } from "bun:test";

import { DEFAULT_RPC_URLS, Network } from "./config.js";

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
