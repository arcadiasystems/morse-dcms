import { describe, expect, test } from "bun:test";

import { ValidationError } from "../errors.js";
import { type SealId, SealPolicyTag } from "../types.js";
import {
	buildRecipientFileSealId,
	decodeRecipientFileSealId,
	RECOMMENDED_SEAL_NONCE_BYTES,
	RECOMMENDED_SEAL_PREFIX_BYTES,
	randomSealNonce,
	randomSealPrefix,
} from "./recipient-file-identity.js";

describe("buildRecipientFileSealId", () => {
	test("layout is prefix || tag(3) || nonce", () => {
		const prefix = new Uint8Array([1, 2, 3, 4]);
		const nonce = new Uint8Array([0xaa, 0xbb]);
		const id = buildRecipientFileSealId(prefix, nonce);
		expect(id.length).toBe(prefix.length + 1 + nonce.length);
		expect([...id.slice(0, 4)]).toEqual([1, 2, 3, 4]);
		expect(id[4]).toBe(SealPolicyTag.RecipientFile);
		expect([...id.slice(5)]).toEqual([0xaa, 0xbb]);
	});

	test("rejects an empty prefix", () => {
		expect(() =>
			buildRecipientFileSealId(new Uint8Array(0), new Uint8Array([1])),
		).toThrow(ValidationError);
	});

	test("rejects an empty nonce", () => {
		expect(() =>
			buildRecipientFileSealId(new Uint8Array([1]), new Uint8Array(0)),
		).toThrow(ValidationError);
	});

	test("accepts the recommended 32-byte prefix + 16-byte nonce", () => {
		const prefix = new Uint8Array(RECOMMENDED_SEAL_PREFIX_BYTES);
		const nonce = new Uint8Array(RECOMMENDED_SEAL_NONCE_BYTES);
		for (let i = 0; i < prefix.length; i += 1) prefix[i] = i + 1;
		for (let i = 0; i < nonce.length; i += 1) nonce[i] = 0xff - i;
		const id = buildRecipientFileSealId(prefix, nonce);
		expect(id.length).toBe(49);
	});
});

describe("decodeRecipientFileSealId", () => {
	test("round-trips a built identity", () => {
		const prefix = new Uint8Array([7, 8, 9]);
		const nonce = new Uint8Array([0x11, 0x22, 0x33]);
		const id = buildRecipientFileSealId(prefix, nonce);
		const parts = decodeRecipientFileSealId(id, prefix.length);
		expect([...parts.prefix]).toEqual([...prefix]);
		expect(parts.policyTag).toBe(SealPolicyTag.RecipientFile);
		expect([...parts.nonce]).toEqual([...nonce]);
	});

	test("rejects an identity carrying a non-recipient-file policy tag", () => {
		// Hand-craft an identity with tag=1 (publisher) instead of 3.
		const bytes = new Uint8Array([1, 2, 3, 1, 0xaa]);
		expect(() => decodeRecipientFileSealId(bytes as SealId, 3)).toThrow(
			ValidationError,
		);
	});

	test("rejects an identity shorter than prefix + tag + nonce", () => {
		const bytes = new Uint8Array([1, 2, 3, SealPolicyTag.RecipientFile]);
		expect(() => decodeRecipientFileSealId(bytes as SealId, 3)).toThrow(
			ValidationError,
		);
	});

	test("rejects a prefixLength of 0", () => {
		const bytes = new Uint8Array([SealPolicyTag.RecipientFile, 0xaa]);
		expect(() => decodeRecipientFileSealId(bytes as SealId, 0)).toThrow(
			ValidationError,
		);
	});
});

describe("randomSealPrefix / randomSealNonce", () => {
	test("randomSealPrefix returns 32 bytes", () => {
		expect(randomSealPrefix().length).toBe(RECOMMENDED_SEAL_PREFIX_BYTES);
	});

	test("randomSealNonce returns 16 bytes", () => {
		expect(randomSealNonce().length).toBe(RECOMMENDED_SEAL_NONCE_BYTES);
	});

	test("two random prefixes are distinct (probabilistic)", () => {
		const a = randomSealPrefix();
		const b = randomSealPrefix();
		expect(a).not.toEqual(b);
	});
});
