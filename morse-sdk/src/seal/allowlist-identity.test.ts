import { describe, expect, test } from "bun:test";

import { toAllowlistId } from "../codecs.js";
import { ValidationError } from "../errors.js";
import { SealPolicyTag } from "../types.js";
import {
	buildAllowlistSealId,
	decodeAllowlistSealId,
} from "./allowlist-identity.js";

const ALLOWLIST_ID = toAllowlistId(
	"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);

describe("buildAllowlistSealId", () => {
	test("produces a 32 + 1 + nonce.length byte identity", () => {
		const nonce = new Uint8Array([1, 2, 3, 4]);
		const id = buildAllowlistSealId(ALLOWLIST_ID, nonce);
		expect(id.length).toBe(32 + 1 + 4);
	});

	test("policy tag byte is SealPolicyTag.Allowlist (2)", () => {
		const id = buildAllowlistSealId(ALLOWLIST_ID, new Uint8Array([0]));
		expect(id[32]).toBe(SealPolicyTag.Allowlist);
		expect(id[32]).toBe(2);
	});

	test("allowlistId prefix matches input bytes", () => {
		const id = buildAllowlistSealId(ALLOWLIST_ID, new Uint8Array([0]));
		const prefix = Array.from(id.slice(0, 32));
		expect(prefix.every((b) => b === 0xaa)).toBe(true);
	});

	test("throws on empty nonce", () => {
		expect(() => buildAllowlistSealId(ALLOWLIST_ID, new Uint8Array(0))).toThrow(
			ValidationError,
		);
	});
});

describe("decodeAllowlistSealId", () => {
	test("round-trips build + decode", () => {
		const nonce = new Uint8Array([9, 8, 7, 6, 5]);
		const id = buildAllowlistSealId(ALLOWLIST_ID, nonce);
		const parts = decodeAllowlistSealId(id);
		expect(parts.allowlistId).toBe(ALLOWLIST_ID);
		expect(parts.policyTag).toBe(SealPolicyTag.Allowlist);
		expect(Array.from(parts.nonce)).toEqual(Array.from(nonce));
	});

	test("rejects identities with publisher policy tag (1)", () => {
		const id = buildAllowlistSealId(ALLOWLIST_ID, new Uint8Array([0]));
		// Tamper: swap the policy tag byte
		id[32] = SealPolicyTag.Publisher;
		expect(() => decodeAllowlistSealId(id)).toThrow(ValidationError);
	});
});
