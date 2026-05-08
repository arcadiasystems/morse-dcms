import { describe, expect, mock, test } from "bun:test";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import type { PublicKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";

import { WalletStandardSigner } from "./wallet-standard-signer.js";

const ADDRESS =
	"0xe9a29a9bdeed3dfc033ce42886eccebcda94bc2ad31c380d5aed19391e0ba9fd";

function fakePublicKey(): PublicKey {
	return {
		toSuiAddress: () => ADDRESS,
	} as unknown as PublicKey;
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
