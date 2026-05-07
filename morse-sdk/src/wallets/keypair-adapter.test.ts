import { describe, expect, mock, test } from "bun:test";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

import type { TransactionExecutor } from "../clients.js";
import { ContractAbortError, TransportError } from "../errors.js";
import { KeypairAdapter } from "./keypair-adapter.js";

interface MockExecutorOverrides {
	signAndExecuteTransaction?: (...args: unknown[]) => Promise<unknown>;
	waitForTransaction?: (...args: unknown[]) => Promise<unknown>;
}

function makeExecutor(
	overrides: MockExecutorOverrides = {},
): TransactionExecutor {
	const defaultSubmitted = {
		$kind: "Transaction",
		Transaction: { digest: "submit-digest" },
	};
	const defaultFinal = {
		$kind: "Transaction",
		Transaction: {
			digest: "final-digest",
			effects: {
				gasUsed: {
					computationCost: "1000",
					storageCost: "2000",
					storageRebate: "500",
				},
				changedObjects: [],
			},
			objectTypes: {},
		},
	};
	return {
		signAndExecuteTransaction:
			overrides.signAndExecuteTransaction ?? mock(async () => defaultSubmitted),
		waitForTransaction:
			overrides.waitForTransaction ?? mock(async () => defaultFinal),
	} as unknown as TransactionExecutor;
}

function makeKeypair(): Ed25519Keypair {
	return Ed25519Keypair.generate();
}

describe("KeypairAdapter", () => {
	test("derives the address from the signer", () => {
		const keypair = makeKeypair();
		const adapter = new KeypairAdapter(keypair, makeExecutor());
		expect(adapter.address as string).toBe(keypair.toSuiAddress());
	});

	test("fromSecretKey constructs an Ed25519-backed adapter", () => {
		const keypair = makeKeypair();
		const secret = keypair.getSecretKey();
		const adapter = KeypairAdapter.fromSecretKey(secret, makeExecutor());
		expect(adapter.address as string).toBe(keypair.toSuiAddress());
	});

	test("returns a typed receipt on the happy path", async () => {
		const adapter = new KeypairAdapter(
			makeKeypair(),
			makeExecutor({
				waitForTransaction: mock(async () => ({
					$kind: "Transaction",
					Transaction: {
						digest: "tx-1",
						effects: {
							gasUsed: {
								computationCost: "1000",
								storageCost: "3000",
								storageRebate: "500",
							},
							changedObjects: [
								{ objectId: "0xabc", idOperation: "Created" },
								{ objectId: "0xdef", idOperation: "Deleted" },
								{ objectId: "0x123", idOperation: "None" },
							],
						},
						objectTypes: {
							"0xabc": "0xpkg::publication::Publication",
						},
					},
				})),
			}),
		);
		const receipt = await adapter.signAndExecuteTransaction(new Transaction());
		expect(receipt.digest).toBe("tx-1");
		expect(receipt.gasUsedMist).toBe(3500n);
		expect(receipt.createdObjects).toHaveLength(1);
		expect(receipt.createdObjects[0]?.objectId as string).toBe("0xabc");
		expect(receipt.createdObjects[0]?.objectType).toBe(
			"0xpkg::publication::Publication",
		);
		expect(receipt.deletedObjects).toHaveLength(1);
		expect(receipt.deletedObjects[0]?.objectId as string).toBe("0xdef");
	});

	test("throws ContractAbortError on a known Move abort", async () => {
		const adapter = new KeypairAdapter(
			makeKeypair(),
			makeExecutor({
				signAndExecuteTransaction: mock(async () => ({
					$kind: "FailedTransaction",
					FailedTransaction: {
						effects: {
							status: {
								success: false,
								error: {
									message: "irrelevant",
									MoveAbort: {
										abortCode: "5",
										location: { module: "publication" },
									},
								},
							},
						},
					},
				})),
			}),
		);
		await expect(
			adapter.signAndExecuteTransaction(new Transaction()),
		).rejects.toThrow(ContractAbortError);
		try {
			await adapter.signAndExecuteTransaction(new Transaction());
		} catch (error) {
			expect(error).toBeInstanceOf(ContractAbortError);
			const abort = error as ContractAbortError;
			expect(abort.module).toBe("publication");
			expect(abort.abortCode).toBe(5);
			expect(abort.reason).toBe("EPublisherCapRevoked");
		}
	});

	test("falls back to TransportError when abort module is unknown", async () => {
		const adapter = new KeypairAdapter(
			makeKeypair(),
			makeExecutor({
				signAndExecuteTransaction: mock(async () => ({
					$kind: "FailedTransaction",
					FailedTransaction: {
						effects: {
							status: {
								success: false,
								error: {
									message: "kernel panic",
									MoveAbort: {
										abortCode: "1",
										location: { module: "stdlib" },
									},
								},
							},
						},
					},
				})),
			}),
		);
		await expect(
			adapter.signAndExecuteTransaction(new Transaction()),
		).rejects.toThrow(TransportError);
	});

	test("wraps RPC throw in TransportError preserving cause", async () => {
		const cause = new Error("connection refused");
		const adapter = new KeypairAdapter(
			makeKeypair(),
			makeExecutor({
				signAndExecuteTransaction: mock(async () => {
					throw cause;
				}),
			}),
		);
		try {
			await adapter.signAndExecuteTransaction(new Transaction());
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(TransportError);
			expect((error as TransportError).cause).toBe(cause);
			expect((error as TransportError).message).toContain(
				"signAndExecuteTransaction",
			);
		}
	});
});
