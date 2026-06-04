import { describe, expect, test } from "bun:test";

import { decodeShare, encodeShare } from "../src/format/share.ts";

const FILE = `0x${"9".repeat(64)}`;
const PREFIX = new Uint8Array([10, 11, 12]);
const NONCE = new Uint8Array([1, 2, 3, 4, 5]);

describe("encodeShare / decodeShare", () => {
	test("round-trips the file id, prefix, and nonce", () => {
		const decoded = decodeShare(encodeShare(FILE, PREFIX, NONCE));
		expect(decoded.fileId).toBe(FILE);
		expect([...decoded.prefix]).toEqual([...PREFIX]);
		expect([...decoded.nonce]).toEqual([...NONCE]);
	});

	test("emits the versioned, dot-separated format", () => {
		const share = encodeShare(FILE, PREFIX, NONCE);
		expect(share.startsWith("mf1.")).toBe(true);
		expect(share.split(".").length).toBe(4);
	});

	test("rejects an unknown version prefix", () => {
		expect(() => decodeShare("mf2.a.b.c")).toThrow(/share string/);
	});

	test("rejects too few parts", () => {
		expect(() => decodeShare("mf1.a.b")).toThrow(/share string/);
	});

	test("rejects an empty bundled field", () => {
		expect(() => decodeShare("mf1...")).toThrow(/empty/);
	});
});
