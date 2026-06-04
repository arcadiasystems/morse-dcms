import { describe, expect, test } from "bun:test";

import { decodeHex, encodeHex } from "../src/format/hex.ts";

describe("encodeHex", () => {
	test("encodes bytes as a 0x-prefixed lowercase string", () => {
		expect(encodeHex(new Uint8Array([0, 255, 16]))).toBe("0x00ff10");
	});
});

describe("decodeHex", () => {
	test("round-trips with encodeHex", () => {
		const bytes = new Uint8Array([1, 2, 3, 254]);
		expect(decodeHex(encodeHex(bytes))).toEqual(bytes);
	});

	test("accepts a value without the 0x prefix", () => {
		expect(decodeHex("00ff10")).toEqual(new Uint8Array([0, 255, 16]));
	});

	test("accepts uppercase hex", () => {
		expect(decodeHex("0xAABB")).toEqual(new Uint8Array([0xaa, 0xbb]));
	});

	test("rejects odd-length, empty, and non-hex values", () => {
		expect(() => decodeHex("0xabc")).toThrow(/hex/);
		expect(() => decodeHex("0x")).toThrow(/hex/);
		expect(() => decodeHex("0xzz")).toThrow(/hex/);
	});
});
