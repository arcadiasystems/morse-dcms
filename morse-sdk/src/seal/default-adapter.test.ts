import { describe, expect, test } from "bun:test";
import {
	NoAccessError,
	type SealCompatibleClient,
	type SessionKey,
} from "@mysten/seal";

import { toPackageId, toPublicationId } from "../codecs.js";
import { MAINNET_SEAL_COMMITTEE, morseConfig } from "../config.js";
import { ConfigurationError, SealError, TransportError } from "../errors.js";
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

/**
 * `fromMorseConfig` builds a real `SealClient`, so these tests read the
 * adapter's resolved fields directly instead of driving `encrypt` (which would
 * make the client fetch key servers over the network). `private` is erased at
 * runtime, so the cast is sound.
 */
function internals(adapter: DefaultSealAdapter): {
	packageId: string;
	targetPackageId: string;
	threshold: number;
} {
	return adapter as unknown as {
		packageId: string;
		targetPackageId: string;
		threshold: number;
	};
}

const UPGRADED_PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000222",
);

describe("DefaultSealAdapter.fromMorseConfig", () => {
	test("defaults threshold to 1 for a single committee-mode key server", () => {
		// The mainnet shape. min(2, 1) = 1 is correct here: the real quorum lives
		// inside the committee aggregator. Raising it would trip fromConfig's
		// threshold <= serverConfigs.length check.
		const adapter = DefaultSealAdapter.fromMorseConfig(
			{
				packageId: PACKAGE_ID,
				sealKeyServers: [
					{
						objectId: "0xcommittee",
						weight: 1,
						aggregatorUrl: "https://aggregator.example",
					},
				],
			},
			{},
			fakeSuiClient(),
		);
		expect(internals(adapter).threshold).toBe(1);
	});

	test("defaults threshold to 2 for a multi-server allowlist", () => {
		// The testnet shape.
		const adapter = DefaultSealAdapter.fromMorseConfig(
			{
				packageId: PACKAGE_ID,
				sealKeyServers: [
					{ objectId: "0xone", weight: 1 },
					{ objectId: "0xtwo", weight: 1 },
				],
			},
			{},
			fakeSuiClient(),
		);
		expect(internals(adapter).threshold).toBe(2);
	});

	test("explicit threshold wins over the default", () => {
		const adapter = DefaultSealAdapter.fromMorseConfig(
			{
				packageId: PACKAGE_ID,
				sealKeyServers: [
					{ objectId: "0xone", weight: 1 },
					{ objectId: "0xtwo", weight: 1 },
				],
			},
			{ threshold: 1 },
			fakeSuiClient(),
		);
		expect(internals(adapter).threshold).toBe(1);
	});

	test("binds identity to originalPackageId and PTB targets to packageId", () => {
		// Swapping these silently produces ciphertexts that stop decrypting after
		// the next package upgrade. On mainnet the two ids are currently equal, so
		// only a config with a real upgrade (testnet) can catch a regression.
		const adapter = DefaultSealAdapter.fromMorseConfig(
			{
				packageId: UPGRADED_PACKAGE_ID,
				originalPackageId: PACKAGE_ID,
				sealKeyServers: [{ objectId: "0xone", weight: 1 }],
			},
			{},
			fakeSuiClient(),
		);
		expect(internals(adapter).packageId).toBe(PACKAGE_ID);
		expect(internals(adapter).targetPackageId).toBe(UPGRADED_PACKAGE_ID);
	});

	test("falls back to packageId for identity when originalPackageId is absent", () => {
		const adapter = DefaultSealAdapter.fromMorseConfig(
			{
				packageId: PACKAGE_ID,
				sealKeyServers: [{ objectId: "0xone", weight: 1 }],
			},
			{},
			fakeSuiClient(),
		);
		expect(internals(adapter).packageId).toBe(PACKAGE_ID);
		expect(internals(adapter).targetPackageId).toBe(PACKAGE_ID);
	});

	test("seal.serverConfigs overrides the config allowlist", () => {
		const adapter = DefaultSealAdapter.fromMorseConfig(
			{
				packageId: PACKAGE_ID,
				sealKeyServers: [
					{ objectId: "0xone", weight: 1 },
					{ objectId: "0xtwo", weight: 1 },
				],
			},
			{ serverConfigs: [{ objectId: "0xmine", weight: 1 }] },
			fakeSuiClient(),
		);
		// Threshold follows the override's length, not the allowlist's.
		expect(internals(adapter).threshold).toBe(1);
	});

	test("a real mainnet morseConfig throws instead of yielding a usable adapter", () => {
		// The regression that shipped in 0.5.0: mainnet defaulted to Mysten's
		// committee, so this call succeeded and only decrypt failed later with a
		// 401, letting a consumer create ciphertext they could never read.
		// Failing here is the fix, and it must fail through the real config.
		expect(() =>
			DefaultSealAdapter.fromMorseConfig(
				morseConfig({ network: "mainnet" }),
				{},
				fakeSuiClient(),
			),
		).toThrow(ConfigurationError);
	});

	test("mainnet works once MAINNET_SEAL_COMMITTEE is supplied", () => {
		const adapter = DefaultSealAdapter.fromMorseConfig(
			morseConfig({
				network: "mainnet",
				sealKeyServers: MAINNET_SEAL_COMMITTEE,
			}),
			{},
			fakeSuiClient(),
		);
		// One committee entry, so the derived threshold is 1.
		expect(internals(adapter).threshold).toBe(1);
	});

	test("throws ConfigurationError when no key servers are available", () => {
		// The localnet / custom-deployment path: morseConfig yields
		// sealKeyServers: [] and the consumer supplied no override.
		expect(() =>
			DefaultSealAdapter.fromMorseConfig(
				{ packageId: PACKAGE_ID, sealKeyServers: [] },
				{},
				fakeSuiClient(),
			),
		).toThrow(ConfigurationError);
	});
});

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
//
// The recipient-file decrypt path forwards an opaque caller-supplied prefix
// to `seal_approve_with_prefix` on chain; there is no useful client-side
// validation to assert against, so its coverage is smoke-only.
