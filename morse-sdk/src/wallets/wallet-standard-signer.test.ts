import { describe, expect, mock, test } from "bun:test";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import type { PublicKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { Transaction } from "@mysten/sui/transactions";
import { toZkLoginPublicIdentifier } from "@mysten/sui/zklogin";

import { ConfigurationError } from "../errors.js";
import { WalletStandardSigner } from "./wallet-standard-signer.js";

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
		).toThrow(/Secp256k1, Secp256r1, or Passkey/);
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
		expect(() =>
			WalletStandardSigner.fromAccount(
				{
					address:
						"0x0000000000000000000000000000000000000000000000000000000000000003",
					publicKey: new Uint8Array(61).fill(0x05),
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
		).toThrow(/multisig or unknown/);
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
