import { describe, expect, test } from "bun:test";

import {
	decryptSecret,
	encryptSecret,
	type ScryptParams,
} from "../src/keystore/crypto.ts";

// Low cost factor keeps the round-trip tests fast; production uses N = 2^17.
const FAST: ScryptParams = { N: 1 << 12, r: 8, p: 1 };

describe("keystore crypto", () => {
	test("decrypts exactly what it encrypts", async () => {
		const plaintext = new TextEncoder().encode("suiprivkey1xyz");
		const payload = await encryptSecret(plaintext, "hunter2hunter2", FAST);
		const decrypted = await decryptSecret(payload, "hunter2hunter2");
		expect(new TextDecoder().decode(decrypted)).toBe("suiprivkey1xyz");
	});

	test("rejects a wrong password", async () => {
		const payload = await encryptSecret(
			new TextEncoder().encode("x"),
			"right-password",
			FAST,
		);
		await expect(decryptSecret(payload, "wrong-password")).rejects.toThrow();
	});

	test("rejects a tampered ciphertext", async () => {
		const payload = await encryptSecret(
			new TextEncoder().encode("abcdef"),
			"pw-correct",
			FAST,
		);
		const tampered = {
			...payload,
			ciphertext: Buffer.from("00", "hex").toString("base64"),
		};
		await expect(decryptSecret(tampered, "pw-correct")).rejects.toThrow();
	});

	test("uses a fresh salt and iv per encryption", async () => {
		const plaintext = new TextEncoder().encode("same-input");
		const a = await encryptSecret(plaintext, "pw", FAST);
		const b = await encryptSecret(plaintext, "pw", FAST);
		expect(a.salt).not.toBe(b.salt);
		expect(a.iv).not.toBe(b.iv);
		expect(a.ciphertext).not.toBe(b.ciphertext);
	});
});
