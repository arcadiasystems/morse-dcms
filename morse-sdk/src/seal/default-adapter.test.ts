import { describe, expect, test } from "bun:test";
import {
	NoAccessError,
	type SealCompatibleClient,
	type SessionKey,
} from "@mysten/seal";

import { toAllowlistId, toPackageId, toPublicationId } from "../codecs.js";
import { SealError, TransportError } from "../errors.js";
import { buildAllowlistSealId } from "./allowlist-identity.js";
import { DefaultSealAdapter } from "./default-adapter.js";
import { buildPublisherSealId } from "./identity.js";

interface FakeSealClient {
	encrypt(args: {
		threshold: number;
		packageId: string;
		id: string;
		data: Uint8Array;
		aad?: Uint8Array;
	}): Promise<{ encryptedObject: Uint8Array; key: Uint8Array }>;
	decrypt(args: {
		data: Uint8Array;
		sessionKey: SessionKey;
		txBytes: Uint8Array;
	}): Promise<Uint8Array>;
}

const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const PUBLICATION_ID = toPublicationId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const SEAL_ID = buildPublisherSealId(
	PUBLICATION_ID,
	new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
);

function fakeSuiClient(): SealCompatibleClient {
	return {} as unknown as SealCompatibleClient;
}

interface ClientCalls {
	encrypt: unknown[];
	decrypt: unknown[];
}

function fakeClient(
	overrides: Partial<{
		encrypt: (args: unknown) => Promise<unknown>;
		decrypt: (args: unknown) => Promise<unknown>;
	}> = {},
): { client: FakeSealClient; calls: ClientCalls } {
	const calls: ClientCalls = { encrypt: [], decrypt: [] };
	const client: FakeSealClient = {
		encrypt: async (args) => {
			calls.encrypt.push(args);
			if (overrides.encrypt) {
				return overrides.encrypt(args) as ReturnType<FakeSealClient["encrypt"]>;
			}
			return {
				encryptedObject: new Uint8Array([0xc1, 0xc2]),
				key: new Uint8Array(32),
			};
		},
		decrypt: async (args) => {
			calls.decrypt.push(args);
			if (overrides.decrypt) {
				return overrides.decrypt(args) as ReturnType<FakeSealClient["decrypt"]>;
			}
			return new Uint8Array([0xde, 0xcd]);
		},
	};
	return { client, calls };
}

describe("DefaultSealAdapter.encrypt", () => {
	test("forwards plaintext + sealId hex + threshold + packageId", async () => {
		const { client, calls } = fakeClient();
		const adapter = new DefaultSealAdapter({
			client,
			suiClient: fakeSuiClient(),
			packageId: PACKAGE_ID,
			targetPackageId: PACKAGE_ID,
			threshold: 2,
		});
		const data = new Uint8Array([1, 2, 3]);

		const result = await adapter.encrypt(data, { sealId: SEAL_ID });

		expect(Array.from(result.ciphertext)).toEqual([0xc1, 0xc2]);
		expect(calls.encrypt).toHaveLength(1);
		const args = calls.encrypt[0] as Record<string, unknown>;
		expect(args.threshold).toBe(2);
		expect(args.packageId).toBe(PACKAGE_ID as string);
		expect(args.data).toBe(data);
		expect(typeof args.id).toBe("string");
		expect((args.id as string).startsWith("0x")).toBe(true);
	});

	test("does not surface the symmetric key", async () => {
		const { client } = fakeClient();
		const adapter = new DefaultSealAdapter({
			client,
			suiClient: fakeSuiClient(),
			packageId: PACKAGE_ID,
			targetPackageId: PACKAGE_ID,
			threshold: 2,
		});
		const result = await adapter.encrypt(new Uint8Array([1]), {
			sealId: SEAL_ID,
		});
		expect("symmetricKey" in result).toBe(false);
		expect("key" in result).toBe(false);
	});

	test("forwards aad when supplied", async () => {
		const { client, calls } = fakeClient();
		const adapter = new DefaultSealAdapter({
			client,
			suiClient: fakeSuiClient(),
			packageId: PACKAGE_ID,
			targetPackageId: PACKAGE_ID,
			threshold: 2,
		});
		await adapter.encrypt(new Uint8Array([1]), {
			sealId: SEAL_ID,
			aad: new Uint8Array([0xaa]),
		});
		const args = calls.encrypt[0] as Record<string, unknown>;
		expect(args.aad).toBeDefined();
	});

	test("maps NoAccessError to SealError code 'no-access'", async () => {
		const { client } = fakeClient({
			encrypt: async () => {
				throw new NoAccessError("nope");
			},
		});
		const adapter = new DefaultSealAdapter({
			client,
			suiClient: fakeSuiClient(),
			packageId: PACKAGE_ID,
			targetPackageId: PACKAGE_ID,
			threshold: 2,
		});
		try {
			await adapter.encrypt(new Uint8Array([1]), { sealId: SEAL_ID });
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(SealError);
			expect((error as SealError).code).toBe("no-access");
		}
	});

	test("wraps unknown errors as TransportError", async () => {
		const { client } = fakeClient({
			encrypt: async () => {
				throw new Error("network down");
			},
		});
		const adapter = new DefaultSealAdapter({
			client,
			suiClient: fakeSuiClient(),
			packageId: PACKAGE_ID,
			targetPackageId: PACKAGE_ID,
			threshold: 2,
		});
		await expect(
			adapter.encrypt(new Uint8Array([1]), { sealId: SEAL_ID }),
		).rejects.toBeInstanceOf(TransportError);
	});
});

// decrypt happy-path needs a live Sui client to resolve object refs in
// `tx.build()`; covered by the testnet smoke. Encrypt-side coverage exercises
// the same SealError mapping decrypt would hit post-build.

describe("DefaultSealAdapter.decryptUnderAllowlist", () => {
	test("rejects sealId whose embedded allowlistId differs from the supplied one", async () => {
		// Catch-the-bait: caller passes one allowlistId, but the sealId was
		// built against a different one. The decrypt path must refuse before
		// the key servers see the request.
		const ALLOWLIST_A = toAllowlistId(
			"0x000000000000000000000000000000000000000000000000000000000000aaaa",
		);
		const ALLOWLIST_B = toAllowlistId(
			"0x000000000000000000000000000000000000000000000000000000000000bbbb",
		);
		const sealIdForB = buildAllowlistSealId(
			ALLOWLIST_B,
			new Uint8Array([1, 2, 3, 4]),
		);

		const { client } = fakeClient();
		const adapter = new DefaultSealAdapter({
			client,
			suiClient: fakeSuiClient(),
			packageId: PACKAGE_ID,
			targetPackageId: PACKAGE_ID,
			threshold: 2,
		});

		try {
			await adapter.decryptUnderAllowlist(new Uint8Array([0xc1]), {
				sealId: sealIdForB,
				allowlistId: ALLOWLIST_A,
				sessionKey: {} as unknown as SessionKey,
			});
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(SealError);
			expect((error as SealError).code).toBe("decrypt-failed");
		}
	});

	test("rejects sealId with a non-allowlist policy tag", async () => {
		// A publisher-policy sealId reused on the allowlist decrypt path
		// must be rejected, not silently misinterpreted.
		const { client } = fakeClient();
		const adapter = new DefaultSealAdapter({
			client,
			suiClient: fakeSuiClient(),
			packageId: PACKAGE_ID,
			targetPackageId: PACKAGE_ID,
			threshold: 2,
		});
		const ALLOWLIST = toAllowlistId(
			"0x000000000000000000000000000000000000000000000000000000000000aaaa",
		);

		await expect(
			adapter.decryptUnderAllowlist(new Uint8Array([0xc1]), {
				sealId: SEAL_ID, // built with the PUBLISHER policy tag (1), not 2
				allowlistId: ALLOWLIST,
				sessionKey: {} as unknown as SessionKey,
			}),
		).rejects.toBeInstanceOf(SealError);
	});
});
