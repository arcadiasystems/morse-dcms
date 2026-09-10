import { describe, expect, test } from "bun:test";

import {
	assertSealCredentialAccepted,
	sealServersFromEnv,
} from "../src/config/seal.ts";

describe("sealServersFromEnv", () => {
	test("absent when neither variable is set", () => {
		expect(sealServersFromEnv({})).toBeUndefined();
		expect(sealServersFromEnv({ MORSE_SEAL_API_KEY: "" })).toBeUndefined();
	});

	test("MORSE_SEAL_API_KEY yields the committee with the credential attached", () => {
		const got = sealServersFromEnv({ MORSE_SEAL_API_KEY: "k" });
		expect(got?.servers).toHaveLength(1);
		expect(got?.servers[0]?.apiKey).toBe("k");
		expect(got?.servers[0]?.apiKeyName).toBe("X-API-Key");
		// Committee mode needs the aggregator; losing it here would make Seal
		// throw InvalidClientOptionsError at client construction.
		expect(got?.servers[0]?.aggregatorUrl).toContain("seal-aggregator");
	});

	test("the header name is overridable for operators that differ", () => {
		const got = sealServersFromEnv({
			MORSE_SEAL_API_KEY: "k",
			MORSE_SEAL_API_KEY_NAME: "Authorization",
		});
		expect(got?.servers[0]?.apiKeyName).toBe("Authorization");
	});

	test("MORSE_SEAL_KEY_SERVERS wins over the shorthand, being more specific", () => {
		const got = sealServersFromEnv({
			MORSE_SEAL_API_KEY: "k",
			MORSE_SEAL_KEY_SERVERS: '[{"objectId":"0xabc","weight":2}]',
		});
		expect(got?.servers).toEqual([{ objectId: "0xabc", weight: 2 }]);
		// No aggregator to pre-flight against for an arbitrary operator.
		expect(got?.verifyUrl).toBeUndefined();
	});

	test("rejects malformed JSON and malformed entries", () => {
		expect(() =>
			sealServersFromEnv({ MORSE_SEAL_KEY_SERVERS: "nope" }),
		).toThrow(/not valid JSON/);
		expect(() => sealServersFromEnv({ MORSE_SEAL_KEY_SERVERS: "[]" })).toThrow(
			/non-empty/,
		);
		expect(() =>
			sealServersFromEnv({
				MORSE_SEAL_KEY_SERVERS: '[{"objectId":"x","weight":1}]',
			}),
		).toThrow(/0x-prefixed/);
		expect(() =>
			sealServersFromEnv({
				MORSE_SEAL_KEY_SERVERS: '[{"objectId":"0xa","weight":0}]',
			}),
		).toThrow(/positive integer/);
	});
});

describe("assertSealCredentialAccepted", () => {
	const env = {
		servers: [],
		verifyUrl: "https://agg.test",
		apiKeyName: "X-API-Key",
		apiKey: "k",
	};
	const status = (code: number): typeof fetch =>
		(async () =>
			({ status: code }) as unknown as Response) as unknown as typeof fetch;

	test("refuses a credential the operator rejects", async () => {
		// Encrypting with a bad key produces content nobody can ever decrypt.
		for (const code of [401, 403]) {
			await expect(
				assertSealCredentialAccepted(env, status(code)),
			).rejects.toThrow(/rejected your credential/);
		}
	});

	test("accepts a working credential", async () => {
		await expect(
			assertSealCredentialAccepted(env, status(200)),
		).resolves.toBeUndefined();
	});

	test("an unexpected status or an offline check never blocks", async () => {
		// A flaky pre-flight must not stop someone with a valid key from working.
		await expect(
			assertSealCredentialAccepted(env, status(500)),
		).resolves.toBeUndefined();
		const boom = (async () => {
			throw new Error("offline");
		}) as unknown as typeof fetch;
		await expect(
			assertSealCredentialAccepted(env, boom),
		).resolves.toBeUndefined();
	});

	test("skips entirely when there is no aggregator to check", async () => {
		await expect(
			assertSealCredentialAccepted({ servers: [] }, status(401)),
		).resolves.toBeUndefined();
	});
});
