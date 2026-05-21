import { describe, expect, mock, test } from "bun:test";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import type { PublicKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { Transaction } from "@mysten/sui/transactions";
import { toZkLoginPublicIdentifier } from "@mysten/sui/zklogin";

import { ConfigurationError, UnsupportedWalletSchemeError } from "../errors.js";
import {
	type BrowserStorageLike,
	BrowserStoragePubkeyCache,
	type PubkeyCache,
	WalletStandardSigner,
} from "./wallet-standard-signer.js";

function makeFakeStorage(): BrowserStorageLike & {
	snapshot(): Record<string, string>;
} {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
		removeItem: (key: string) => {
			data.delete(key);
		},
		snapshot: () => Object.fromEntries(data),
	};
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i] ?? 0);
	}
	return btoa(binary);
}

// Signature portion zeroed; recovery only verifies the last 32 bytes via
// address-match, so the inner signature need not be cryptographically valid.
function ed25519SigBlob(rawPubkey: Uint8Array): string {
	const blob = new Uint8Array(97);
	blob[0] = 0x00;
	blob.set(rawPubkey, 65);
	return bytesToBase64(blob);
}

const ADDRESS =
	"0xe9a29a9bdeed3dfc033ce42886eccebcda94bc2ad31c380d5aed19391e0ba9fd";

function fakePublicKey(): PublicKey {
	return {
		toSuiAddress: () => ADDRESS,
	} as unknown as PublicKey;
}

function secret(byte: number): Uint8Array {
	return new Uint8Array(32).fill(byte);
}

function fromHex(hex: string): Uint8Array {
	const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
	const out = new Uint8Array(stripped.length / 2);
	for (let i = 0; i < out.length; i += 1) {
		out[i] = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function fakeClient(): ClientWithCoreApi {
	return {
		core: {
			executeTransaction: mock(async () => ({
				$kind: "Transaction",
				Transaction: {
					digest: "tx-digest",
					effects: {
						gasUsed: {
							computationCost: "0",
							storageCost: "0",
							storageRebate: "0",
						},
						changedObjects: [],
						status: { success: true },
					},
				},
			})),
		},
	} as unknown as ClientWithCoreApi;
}

describe("WalletStandardSigner", () => {
	test("getPublicKey and getKeyScheme expose the constructor values", () => {
		const pk = fakePublicKey();
		const signer = new WalletStandardSigner({
			publicKey: pk,
			keyScheme: "ED25519",
			signTransaction: mock(async () => ({
				bytes: "AAAA",
				signature: "sig",
			})),
			signPersonalMessage: mock(async () => ({
				bytes: "AAAA",
				signature: "sig",
			})),
		});
		expect(signer.getPublicKey()).toBe(pk);
		expect(signer.getKeyScheme()).toBe("ED25519");
		expect(signer.toSuiAddress()).toBe(ADDRESS);
	});

	test("sign(bytes) throws because wallets do not expose raw-byte signing", () => {
		const signer = new WalletStandardSigner({
			publicKey: fakePublicKey(),
			keyScheme: "ED25519",
			signTransaction: mock(async () => ({
				bytes: "AAAA",
				signature: "sig",
			})),
			signPersonalMessage: mock(async () => ({
				bytes: "AAAA",
				signature: "sig",
			})),
		});
		expect(() => signer.sign(new Uint8Array([1, 2, 3]))).toThrow(
			ConfigurationError,
		);
		expect(() => signer.sign(new Uint8Array([1, 2, 3]))).toThrow(
			/raw-byte signing/,
		);
	});

	test("signPersonalMessage forwards to the callback", async () => {
		const spy = mock(async () => ({
			bytes: "AAAA",
			signature: "personal-sig",
		}));
		const signer = new WalletStandardSigner({
			publicKey: fakePublicKey(),
			keyScheme: "ED25519",
			signTransaction: mock(async () => ({
				bytes: "BBBB",
				signature: "tx-sig",
			})),
			signPersonalMessage: spy,
		});
		const message = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
		const result = await signer.signPersonalMessage(message);
		expect(result.signature).toBe("personal-sig");
		expect(spy).toHaveBeenCalledTimes(1);
		const calls = spy.mock.calls as unknown as Array<[{ message: Uint8Array }]>;
		expect(calls[0]?.[0]?.message).toBe(message);
	});

	test("signAndExecuteTransaction sets sender, signs via wallet, submits via client", async () => {
		const signTx = mock(async () => ({
			bytes: btoa(String.fromCharCode(0xab, 0xcd, 0xef)),
			signature: "tx-sig",
		}));
		const signer = new WalletStandardSigner({
			publicKey: fakePublicKey(),
			keyScheme: "ED25519",
			signTransaction: signTx,
			signPersonalMessage: mock(async () => ({
				bytes: "AAAA",
				signature: "msg-sig",
			})),
		});
		const client = fakeClient();
		const tx = new Transaction();

		await signer.signAndExecuteTransaction({ transaction: tx, client });

		expect(tx.getData().sender).toBe(ADDRESS);
		expect(signTx).toHaveBeenCalledTimes(1);
		const execSpy = client.core.executeTransaction as unknown as ReturnType<
			typeof mock
		>;
		expect(execSpy).toHaveBeenCalledTimes(1);
		const submitArgs = (
			execSpy.mock.calls as unknown as Array<[Record<string, unknown>]>
		)[0]?.[0];
		expect(submitArgs?.signatures).toEqual(["tx-sig"]);
		expect(submitArgs?.transaction).toBeInstanceOf(Uint8Array);
		expect(Array.from(submitArgs?.transaction as Uint8Array)).toEqual([
			0xab, 0xcd, 0xef,
		]);
	});

	test("fromAccount detects ED25519 from a 32-byte raw public key", () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0x11));
		const signer = WalletStandardSigner.fromAccount(
			{
				address: keypair.toSuiAddress(),
				publicKey: keypair.getPublicKey().toRawBytes(),
			},
			{
				signTransaction: mock(async () => ({ bytes: "AAAA", signature: "s" })),
				signPersonalMessage: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
			},
		);
		expect(signer.getKeyScheme()).toBe("ED25519");
		expect(signer.toSuiAddress()).toBe(keypair.toSuiAddress());
	});

	test("fromAccount detects Secp256k1 from a 33-byte raw public key", () => {
		const keypair = Secp256k1Keypair.fromSecretKey(secret(0x22));
		const signer = WalletStandardSigner.fromAccount(
			{
				address: keypair.toSuiAddress(),
				publicKey: keypair.getPublicKey().toRawBytes(),
			},
			{
				signTransaction: mock(async () => ({ bytes: "AAAA", signature: "s" })),
				signPersonalMessage: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
			},
		);
		expect(signer.getKeyScheme()).toBe("Secp256k1");
		expect(signer.toSuiAddress()).toBe(keypair.toSuiAddress());
	});

	test("fromAccount accepts Slush's flag-prefixed Ed25519 (0x00 || 32 raw)", () => {
		// Captured from Mysten's Slush wallet on 2026-05-10 with an imported
		// Ed25519 keypair. Slush emits Sui's canonical with-flag pubkey
		// encoding via wallet-standard, not raw bytes; the decoder must
		// accept this form.
		const publicKey = fromHex(
			"0x007aacd2412cbcd25c54ae641c7f4f178b8ecbd8f20510d687172e23b19d0305e9",
		);
		const address =
			"0x830bd528f47068329ddbc9fcbd1f0ead051e01b0538897bb260c4c299f44ba3e";
		const signer = WalletStandardSigner.fromAccount(
			{ address, publicKey },
			{
				signTransaction: mock(async () => ({ bytes: "AAAA", signature: "s" })),
				signPersonalMessage: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
			},
		);
		expect(signer.getKeyScheme()).toBe("ED25519");
		expect(signer.toSuiAddress()).toBe(address);
	});

	test("fromAccount accepts a flag-prefixed Secp256k1 (0x01 || 33 raw)", () => {
		const keypair = Secp256k1Keypair.fromSecretKey(secret(0x55));
		const raw = keypair.getPublicKey().toRawBytes();
		const flagged = new Uint8Array(raw.length + 1);
		flagged[0] = 0x01;
		flagged.set(raw, 1);
		const signer = WalletStandardSigner.fromAccount(
			{ address: keypair.toSuiAddress(), publicKey: flagged },
			{
				signTransaction: mock(async () => ({ bytes: "AAAA", signature: "s" })),
				signPersonalMessage: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
			},
		);
		expect(signer.getKeyScheme()).toBe("Secp256k1");
		expect(signer.toSuiAddress()).toBe(keypair.toSuiAddress());
	});

	test("fromAccount detects Secp256r1 from a 33-byte raw public key", () => {
		const keypair = Secp256r1Keypair.fromSecretKey(secret(0x33));
		const signer = WalletStandardSigner.fromAccount(
			{
				address: keypair.toSuiAddress(),
				publicKey: keypair.getPublicKey().toRawBytes(),
			},
			{
				signTransaction: mock(async () => ({ bytes: "AAAA", signature: "s" })),
				signPersonalMessage: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
			},
		);
		expect(signer.getKeyScheme()).toBe("Secp256r1");
		expect(signer.toSuiAddress()).toBe(keypair.toSuiAddress());
	});

	test("fromAccount throws ConfigurationError when a 32-byte key does not derive the address", () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0x44));
		expect(() =>
			WalletStandardSigner.fromAccount(
				{
					address:
						"0x0000000000000000000000000000000000000000000000000000000000000001",
					publicKey: keypair.getPublicKey().toRawBytes(),
				},
				{
					signTransaction: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
					signPersonalMessage: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
				},
			),
		).toThrow(ConfigurationError);
	});

	test("fromAccount throws ConfigurationError when a 33-byte key matches no scheme", () => {
		expect(() =>
			WalletStandardSigner.fromAccount(
				{
					address:
						"0x0000000000000000000000000000000000000000000000000000000000000002",
					publicKey: new Uint8Array(33).fill(0x02),
				},
				{
					signTransaction: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
					signPersonalMessage: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
				},
			),
		).toThrow(/raw nor a flag-prefixed/);
	});

	test("fromAccount detects ZkLogin from a variable-length public identifier", () => {
		const zkPk = toZkLoginPublicIdentifier(
			123456789n,
			"https://accounts.google.com",
			{ legacyAddress: false },
		);
		const signer = WalletStandardSigner.fromAccount(
			{
				address: zkPk.toSuiAddress(),
				publicKey: zkPk.toRawBytes(),
			},
			{
				signTransaction: mock(async () => ({ bytes: "AAAA", signature: "s" })),
				signPersonalMessage: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
			},
		);
		expect(signer.getKeyScheme()).toBe("ZkLogin");
		expect(signer.toSuiAddress()).toBe(zkPk.toSuiAddress());
	});

	test("fromAccount refuses non-conforming variable-length public keys", () => {
		// 0xff-filled 61-byte buffer: not a zkLogin shape (first byte != 0x05),
		// so it routes through the generic non-canonical-pubkey terminus.
		expect(() =>
			WalletStandardSigner.fromAccount(
				{
					address:
						"0x0000000000000000000000000000000000000000000000000000000000000003",
					publicKey: new Uint8Array(61).fill(0xff),
				},
				{
					signTransaction: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
					signPersonalMessage: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
				},
			),
		).toThrow(/non-canonical publicKey encoding/);
	});

	test("signAndExecuteTransaction does not override an explicitly-set sender", async () => {
		const otherAddress =
			"0x1111111111111111111111111111111111111111111111111111111111111111";
		const signer = new WalletStandardSigner({
			publicKey: fakePublicKey(),
			keyScheme: "ED25519",
			signTransaction: mock(async () => ({
				bytes: btoa("\x00"),
				signature: "sig",
			})),
			signPersonalMessage: mock(async () => ({
				bytes: "AAAA",
				signature: "sig",
			})),
		});
		const client = fakeClient();
		const tx = new Transaction();
		tx.setSender(otherAddress);

		await signer.signAndExecuteTransaction({ transaction: tx, client });

		expect(tx.getData().sender).toBe(otherAddress);
	});
});

describe("UnsupportedWalletSchemeError", () => {
	test("carries code, raw bytes, and address from the rejecting wallet", () => {
		const junk = new Uint8Array(59).fill(0xd3);
		const address =
			"0x0000000000000000000000000000000000000000000000000000000000000099";
		try {
			WalletStandardSigner.fromAccount(
				{ address, publicKey: junk },
				{
					signTransaction: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
					signPersonalMessage: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
				},
			);
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(UnsupportedWalletSchemeError);
			expect(error).toBeInstanceOf(ConfigurationError);
			const err = error as UnsupportedWalletSchemeError;
			expect(err.code).toBe("non-canonical-pubkey");
			expect(Array.from(err.publicKeyBytes)).toEqual(Array.from(junk));
			expect(err.address).toBe(address);
		}
	});
});

describe("WalletStandardSigner.fromAccountAsync", () => {
	test("compliant wallet (32-byte Ed25519): does not invoke signPersonalMessage", async () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0xaa));
		const probe = mock(async () => ({ bytes: "AAAA", signature: "s" }));
		const signer = await WalletStandardSigner.fromAccountAsync(
			{
				address: keypair.getPublicKey().toSuiAddress(),
				publicKey: keypair.getPublicKey().toRawBytes(),
			},
			{
				signTransaction: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
				signPersonalMessage: probe,
			},
		);
		expect(signer.getKeyScheme()).toBe("ED25519");
		expect(signer.toSuiAddress()).toBe(keypair.getPublicKey().toSuiAddress());
		expect(probe).not.toHaveBeenCalled();
	});

	test("non-canonical publicKey (Phantom-shape): recovers Ed25519 pubkey from probe signature", async () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0xbb));
		const realPubkey = keypair.getPublicKey().toRawBytes();
		const address = keypair.getPublicKey().toSuiAddress();
		// 59-byte opaque blob mimicking Phantom's account.publicKey
		const phantomGarbage = new Uint8Array(59).fill(0xd3);
		const probe = mock(async () => ({
			bytes: "AAAA",
			signature: ed25519SigBlob(realPubkey),
		}));
		const signer = await WalletStandardSigner.fromAccountAsync(
			{ address, publicKey: phantomGarbage },
			{
				signTransaction: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
				signPersonalMessage: probe,
			},
		);
		expect(signer.getKeyScheme()).toBe("ED25519");
		expect(signer.toSuiAddress()).toBe(address);
		expect(probe).toHaveBeenCalledTimes(1);
		const probeCall = (probe as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
			message: Uint8Array;
		};
		const probeMessage = new TextDecoder().decode(probeCall.message);
		expect(probeMessage).toContain("morse-sdk:wallet-pubkey-recovery:");
		expect(probeMessage).toContain(address);
	});

	test("rejects with code=recovery-sig-length when probe signature is wrong length", async () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0xcc));
		const address = keypair.getPublicKey().toSuiAddress();
		const probe = mock(async () => ({
			bytes: "AAAA",
			// 64-byte raw signature, no flag/pubkey appended
			signature: bytesToBase64(new Uint8Array(64)),
		}));
		try {
			await WalletStandardSigner.fromAccountAsync(
				{ address, publicKey: new Uint8Array(59).fill(0xd3) },
				{
					signTransaction: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
					signPersonalMessage: probe,
				},
			);
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(UnsupportedWalletSchemeError);
			expect((error as UnsupportedWalletSchemeError).code).toBe(
				"recovery-sig-length",
			);
		}
	});

	test("rejects with code=recovery-non-ed25519 when probe signature uses other flag", async () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0xdd));
		const address = keypair.getPublicKey().toSuiAddress();
		const sig = new Uint8Array(97);
		sig[0] = 0x01;
		const probe = mock(async () => ({
			bytes: "AAAA",
			signature: bytesToBase64(sig),
		}));
		try {
			await WalletStandardSigner.fromAccountAsync(
				{ address, publicKey: new Uint8Array(59).fill(0xd3) },
				{
					signTransaction: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
					signPersonalMessage: probe,
				},
			);
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(UnsupportedWalletSchemeError);
			expect((error as UnsupportedWalletSchemeError).code).toBe(
				"recovery-non-ed25519",
			);
		}
	});

	test("rejects with code=recovery-address-mismatch when recovered pubkey derives elsewhere", async () => {
		const realKeypair = Ed25519Keypair.fromSecretKey(secret(0xee));
		const otherKeypair = Ed25519Keypair.fromSecretKey(secret(0xef));
		const probe = mock(async () => ({
			bytes: "AAAA",
			signature: ed25519SigBlob(otherKeypair.getPublicKey().toRawBytes()),
		}));
		try {
			await WalletStandardSigner.fromAccountAsync(
				{
					address: realKeypair.getPublicKey().toSuiAddress(),
					publicKey: new Uint8Array(59).fill(0xd3),
				},
				{
					signTransaction: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
					signPersonalMessage: probe,
				},
			);
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(UnsupportedWalletSchemeError);
			expect((error as UnsupportedWalletSchemeError).code).toBe(
				"recovery-address-mismatch",
			);
		}
	});

	test("non-recoverable shape (zkLogin-length) propagates without firing the probe", async () => {
		// 61-byte buffer with 0x05 prefix mimics a malformed zkLogin identifier.
		// fromAccount throws UnsupportedWalletSchemeError but the code prevents
		// fromAccountAsync from escalating to a signPersonalMessage probe.
		const probe = mock(async () => ({
			bytes: "AAAA",
			signature: ed25519SigBlob(new Uint8Array(32)),
		}));
		await expect(
			WalletStandardSigner.fromAccountAsync(
				{
					address:
						"0x0000000000000000000000000000000000000000000000000000000000000077",
					publicKey: new Uint8Array(61).fill(0x05),
				},
				{
					signTransaction: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
					signPersonalMessage: probe,
				},
			),
		).rejects.toBeInstanceOf(UnsupportedWalletSchemeError);
		expect(probe).not.toHaveBeenCalled();
	});

	test("forwards unrelated errors (e.g. user rejected probe popup)", async () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0xf0));
		class UserRejected extends Error {}
		const probe = mock(async () => {
			throw new UserRejected("user rejected");
		});
		await expect(
			WalletStandardSigner.fromAccountAsync(
				{
					address: keypair.getPublicKey().toSuiAddress(),
					publicKey: new Uint8Array(59).fill(0xd3),
				},
				{
					signTransaction: mock(async () => ({
						bytes: "AAAA",
						signature: "s",
					})),
					signPersonalMessage: probe,
				},
			),
		).rejects.toBeInstanceOf(UserRejected);
	});
});

describe("fromAccountAsync with pubkeyCache", () => {
	test("cache hit (valid bytes): skips probe and constructs signer from cached pubkey", async () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0xa1));
		const address = keypair.getPublicKey().toSuiAddress();
		const cache: PubkeyCache = {
			get: mock(async () => keypair.getPublicKey().toRawBytes()),
			set: mock(async () => {}),
			clear: mock(async () => {}),
		};
		const probe = mock(async () => ({
			bytes: "AAAA",
			signature: ed25519SigBlob(keypair.getPublicKey().toRawBytes()),
		}));
		const signer = await WalletStandardSigner.fromAccountAsync(
			{ address, publicKey: new Uint8Array(59).fill(0xd3) },
			{
				signTransaction: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
				signPersonalMessage: probe,
			},
			{ pubkeyCache: cache },
		);
		expect(signer.getKeyScheme()).toBe("ED25519");
		expect(signer.toSuiAddress()).toBe(address);
		expect(cache.get).toHaveBeenCalledWith(address);
		expect(probe).not.toHaveBeenCalled();
		expect(cache.set).not.toHaveBeenCalled();
	});

	test("cache miss: probes, then persists recovered pubkey via set", async () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0xa2));
		const address = keypair.getPublicKey().toSuiAddress();
		const rawPubkey = keypair.getPublicKey().toRawBytes();
		const setSpy = mock(async () => {});
		const cache: PubkeyCache = {
			get: mock(async () => null),
			set: setSpy,
			clear: mock(async () => {}),
		};
		const probe = mock(async () => ({
			bytes: "AAAA",
			signature: ed25519SigBlob(rawPubkey),
		}));
		await WalletStandardSigner.fromAccountAsync(
			{ address, publicKey: new Uint8Array(59).fill(0xd3) },
			{
				signTransaction: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
				signPersonalMessage: probe,
			},
			{ pubkeyCache: cache },
		);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(setSpy).toHaveBeenCalledTimes(1);
		const setArgs = (setSpy as ReturnType<typeof mock>).mock.calls[0] as [
			string,
			Uint8Array,
		];
		expect(setArgs[0]).toBe(address);
		expect(Array.from(setArgs[1])).toEqual(Array.from(rawPubkey));
	});

	test("cache hit (stale bytes that derive elsewhere): clears, re-probes, overwrites", async () => {
		const realKeypair = Ed25519Keypair.fromSecretKey(secret(0xa3));
		const staleKeypair = Ed25519Keypair.fromSecretKey(secret(0xa4));
		const address = realKeypair.getPublicKey().toSuiAddress();
		const clearSpy = mock(async () => {});
		const setSpy = mock(async () => {});
		const cache: PubkeyCache = {
			get: mock(async () => staleKeypair.getPublicKey().toRawBytes()),
			set: setSpy,
			clear: clearSpy,
		};
		const probe = mock(async () => ({
			bytes: "AAAA",
			signature: ed25519SigBlob(realKeypair.getPublicKey().toRawBytes()),
		}));
		const signer = await WalletStandardSigner.fromAccountAsync(
			{ address, publicKey: new Uint8Array(59).fill(0xd3) },
			{
				signTransaction: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
				signPersonalMessage: probe,
			},
			{ pubkeyCache: cache },
		);
		expect(clearSpy).toHaveBeenCalledWith(address);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(setSpy).toHaveBeenCalledTimes(1);
		expect(signer.toSuiAddress()).toBe(address);
	});

	test("cache hit (corrupt length): clears entry, re-probes, returns valid signer", async () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0xa5));
		const address = keypair.getPublicKey().toSuiAddress();
		const clearSpy = mock(async () => {});
		const cache: PubkeyCache = {
			// 16 bytes: too short for any valid Ed25519 raw key
			get: mock(async () => new Uint8Array(16)),
			set: mock(async () => {}),
			clear: clearSpy,
		};
		const probe = mock(async () => ({
			bytes: "AAAA",
			signature: ed25519SigBlob(keypair.getPublicKey().toRawBytes()),
		}));
		const signer = await WalletStandardSigner.fromAccountAsync(
			{ address, publicKey: new Uint8Array(59).fill(0xd3) },
			{
				signTransaction: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
				signPersonalMessage: probe,
			},
			{ pubkeyCache: cache },
		);
		expect(clearSpy).toHaveBeenCalledWith(address);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(signer.toSuiAddress()).toBe(address);
	});

	test("sync cache (get returns Uint8Array directly): works without await", async () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0xa6));
		const address = keypair.getPublicKey().toSuiAddress();
		const cache: PubkeyCache = {
			get: () => keypair.getPublicKey().toRawBytes(),
			set: () => {},
		};
		const probe = mock(async () => ({
			bytes: "AAAA",
			signature: ed25519SigBlob(new Uint8Array(32)),
		}));
		const signer = await WalletStandardSigner.fromAccountAsync(
			{ address, publicKey: new Uint8Array(59).fill(0xd3) },
			{
				signTransaction: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
				signPersonalMessage: probe,
			},
			{ pubkeyCache: cache },
		);
		expect(signer.toSuiAddress()).toBe(address);
		expect(probe).not.toHaveBeenCalled();
	});

	test("cache hit with no clear method: stale entry falls through without error", async () => {
		const realKeypair = Ed25519Keypair.fromSecretKey(secret(0xa7));
		const staleKeypair = Ed25519Keypair.fromSecretKey(secret(0xa8));
		const address = realKeypair.getPublicKey().toSuiAddress();
		const cache: PubkeyCache = {
			get: () => staleKeypair.getPublicKey().toRawBytes(),
			set: () => {},
			// `clear` intentionally omitted
		};
		const probe = mock(async () => ({
			bytes: "AAAA",
			signature: ed25519SigBlob(realKeypair.getPublicKey().toRawBytes()),
		}));
		const signer = await WalletStandardSigner.fromAccountAsync(
			{ address, publicKey: new Uint8Array(59).fill(0xd3) },
			{
				signTransaction: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
				signPersonalMessage: probe,
			},
			{ pubkeyCache: cache },
		);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(signer.toSuiAddress()).toBe(address);
	});

	test("compliant wallet (sync path): cache is not consulted", async () => {
		const keypair = Ed25519Keypair.fromSecretKey(secret(0xa9));
		const cache: PubkeyCache = {
			get: mock(async () => null),
			set: mock(async () => {}),
		};
		const signer = await WalletStandardSigner.fromAccountAsync(
			{
				address: keypair.getPublicKey().toSuiAddress(),
				publicKey: keypair.getPublicKey().toRawBytes(),
			},
			{
				signTransaction: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
				signPersonalMessage: mock(async () => ({
					bytes: "AAAA",
					signature: "s",
				})),
			},
			{ pubkeyCache: cache },
		);
		expect(cache.get).not.toHaveBeenCalled();
		expect(cache.set).not.toHaveBeenCalled();
		expect(signer.toSuiAddress()).toBe(keypair.getPublicKey().toSuiAddress());
	});
});

describe("BrowserStoragePubkeyCache", () => {
	test("round-trip: set then get returns the same bytes", () => {
		const storage = makeFakeStorage();
		const cache = new BrowserStoragePubkeyCache({ storage });
		const pubkey = new Uint8Array(32).fill(0xab);
		cache.set("0xabc", pubkey);
		const got = cache.get("0xabc");
		expect(got).not.toBeNull();
		expect(Array.from(got as Uint8Array)).toEqual(Array.from(pubkey));
	});

	test("get on missing key returns null", () => {
		const storage = makeFakeStorage();
		const cache = new BrowserStoragePubkeyCache({ storage });
		expect(cache.get("0xnope")).toBeNull();
	});

	test("clear removes the entry", () => {
		const storage = makeFakeStorage();
		const cache = new BrowserStoragePubkeyCache({ storage });
		cache.set("0xabc", new Uint8Array(32).fill(0x11));
		cache.clear("0xabc");
		expect(cache.get("0xabc")).toBeNull();
	});

	test("custom prefix namespaces entries", () => {
		const storage = makeFakeStorage();
		const cache = new BrowserStoragePubkeyCache({
			storage,
			prefix: "test:",
		});
		cache.set("0xabc", new Uint8Array(32).fill(0x22));
		expect(storage.snapshot()).toEqual({
			"test:0xabc": expect.any(String) as string,
		});
	});

	test("corrupt entry (non-base64) returns null without throwing", () => {
		const storage = makeFakeStorage();
		storage.setItem("morse-sdk:wallet-pubkey:0xabc", "not-valid-base64!@#$");
		const cache = new BrowserStoragePubkeyCache({ storage });
		expect(cache.get("0xabc")).toBeNull();
	});

	test("getItem returning empty string is treated as miss (shim compat)", () => {
		const shimStorage: BrowserStorageLike = {
			getItem: () => "",
			setItem: () => {},
			removeItem: () => {},
		};
		const cache = new BrowserStoragePubkeyCache({ storage: shimStorage });
		expect(cache.get("0xabc")).toBeNull();
	});

	test("constructor throws when localStorage is unavailable and no storage passed", () => {
		const originalLocalStorage = globalThis.localStorage;
		// @ts-expect-error - intentionally remove for the test
		globalThis.localStorage = undefined;
		try {
			expect(() => new BrowserStoragePubkeyCache()).toThrow(ConfigurationError);
		} finally {
			Object.defineProperty(globalThis, "localStorage", {
				value: originalLocalStorage,
				configurable: true,
			});
		}
	});

	test("end-to-end: cache survives across two fromAccountAsync calls (only one probe)", async () => {
		const storage = makeFakeStorage();
		const cache = new BrowserStoragePubkeyCache({ storage });
		const keypair = Ed25519Keypair.fromSecretKey(secret(0xaa));
		const address = keypair.getPublicKey().toSuiAddress();
		const probe = mock(async () => ({
			bytes: "AAAA",
			signature: ed25519SigBlob(keypair.getPublicKey().toRawBytes()),
		}));
		const callbacks = {
			signTransaction: mock(async () => ({
				bytes: "AAAA",
				signature: "s",
			})),
			signPersonalMessage: probe,
		};
		const account = {
			address,
			publicKey: new Uint8Array(59).fill(0xd3),
		};
		await WalletStandardSigner.fromAccountAsync(account, callbacks, {
			pubkeyCache: cache,
		});
		await WalletStandardSigner.fromAccountAsync(account, callbacks, {
			pubkeyCache: cache,
		});
		expect(probe).toHaveBeenCalledTimes(1);
	});
});
