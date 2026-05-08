/**
 * WalletStandardAdapter: implementing `WalletAdapter` against a wallet that
 * speaks the wallet-standard protocol (Sui Wallet, Suiet, Slush, etc.) in a
 * browser app.
 *
 * In browser apps, the typical wiring is:
 *
 * 1. Wrap your app in `WalletProvider` from `@mysten/dapp-kit`.
 * 2. Use `useCurrentAccount()` to get the connected account's address.
 * 3. Use `useSignAndExecuteTransaction()` to get a sign+execute callback.
 * 4. Use `useSignPersonalMessage()` for Seal SessionKey construction.
 * 5. Construct `WalletStandardAdapter` with those values plus a
 *    `TransactionExecutor` (typically `SuiGrpcClient`).
 *
 * This file is illustrative and compile-checked, but it does NOT import
 * `@mysten/dapp-kit` — that would force a peer dep on every SDK consumer.
 * Real consumer code imports the dapp-kit hooks and passes their results
 * through. The same shape works against any framework's bindings (Vue,
 * Svelte, vanilla TS) — only how you obtain the values changes.
 *
 * Function and value names in this file are illustrative.
 */

import type { SuiClientTypes } from "@mysten/sui/client";
import type { Transaction } from "@mysten/sui/transactions";

import {
	type ObjectReader,
	type SimulationReturnValues,
	type SuiAddress,
	type SuiObjectId,
	type TransactionExecutor,
	TransportError,
	type TxCreatedObject,
	type TxDeletedObject,
	type TxReceipt,
	toSuiAddress,
	toSuiObjectId,
	type WalletAdapter,
} from "morse-sdk";

/**
 * Shape returned by the wallet-standard sign+execute API. Matches dapp-kit's
 * `useSignAndExecuteTransaction().mutateAsync` when invoked with
 * `{ transaction }`: the wallet completes its sign-and-submit dance and
 * resolves with the digest plus partial transaction info.
 */
export type WalletSignAndExecute = (input: {
	transaction: Transaction;
}) => Promise<{ digest: string }>;

/**
 * `WalletAdapter` against a wallet-standard signer.
 *
 * - `signAndExecuteTransaction` delegates signing+submission to the wallet
 *   (the wallet handles user confirmation, key custody), then waits for the
 *   transaction to surface with effects via the SDK's gRPC client.
 * - `simulateTransaction` runs locally against the gRPC client; no wallet
 *   prompt. Sets the sender from the connected address so the simulator
 *   accepts owned-object references.
 *
 * The receipt-parsing logic mirrors `KeypairAdapter`'s. In a real consumer,
 * extract these helpers if you implement multiple custom adapters.
 */
export class WalletStandardAdapter implements WalletAdapter {
	readonly address: SuiAddress;

	constructor(
		address: string,
		private readonly signAndExecute: WalletSignAndExecute,
		private readonly client: TransactionExecutor,
	) {
		this.address = toSuiAddress(address);
	}

	async signAndExecuteTransaction(
		tx: Transaction,
		signal?: AbortSignal,
	): Promise<TxReceipt> {
		let digest: string;
		try {
			const result = await this.signAndExecute({ transaction: tx });
			digest = result.digest;
		} catch (cause) {
			throw new TransportError("wallet sign-and-execute failed", { cause });
		}

		// Wait for the transaction to be available with effects + objectTypes,
		// then parse into a TxReceipt the same way KeypairAdapter does.
		const final = await this.client.waitForTransaction({
			digest,
			include: { effects: true, objectTypes: true },
			...(signal === undefined ? {} : { signal }),
		});

		if (final.$kind === "FailedTransaction") {
			throw new TransportError(
				failedTransactionMessage(final.FailedTransaction),
			);
		}
		return parseTxReceipt(final.Transaction);
	}

	async simulateTransaction(
		tx: Transaction,
		signal?: AbortSignal,
	): Promise<SimulationReturnValues> {
		// Simulation does not require the wallet; the SDK calls it directly.
		// `setSenderIfNotSet` ensures owned-object references resolve correctly
		// against the connected address (zero-address sender is the default).
		tx.setSenderIfNotSet(this.address);
		const result = await this.client.simulateTransaction({
			transaction: tx,
			include: { effects: true, commandResults: true },
			...(signal === undefined ? {} : { signal }),
		});
		if (result.$kind === "FailedTransaction") {
			throw new TransportError(
				failedTransactionMessage(result.FailedTransaction),
			);
		}
		const commandResults = result.commandResults ?? [];
		return commandResults.map((cmd) => cmd.returnValues.map((rv) => rv.bcs));
	}
}

/**
 * Build a SessionKey-shaped signer from a wallet's `signPersonalMessage`
 * mutation. Use this with `SessionKey.create({ signer, ... })` from
 * `@mysten/seal` to keep all signing inside the wallet boundary.
 *
 * In dapp-kit, `useSignPersonalMessage().mutateAsync` returns
 * `{ signature: string, ... }`. Adapt that to the `Signer.signPersonalMessage`
 * shape `@mysten/seal` expects:
 *
 *   ```ts
 *   const sessionSigner = walletStandardSigner(
 *     account.address,
 *     async (message) => {
 *       const { signature } = await signPersonalMessage.mutateAsync({ message });
 *       return { bytes: btoa(...), signature }; // exact shape per @mysten/seal docs
 *     },
 *   );
 *   const sessionKey = await SessionKey.create({
 *     address: account.address,
 *     packageId: morseConfig.originalPackageId ?? morseConfig.packageId,
 *     ttlMin: 10,
 *     signer: sessionSigner,
 *     suiClient: client,
 *   });
 *   ```
 *
 * The exact return shape of `signPersonalMessage` and what Seal's `Signer`
 * interface expects can shift between minor versions of `@mysten/seal`;
 * consult the version-specific docs when wiring this in production.
 */
export function walletStandardSignerNote(): void {
	// Intentionally left as a documentation comment. SessionKey wiring is
	// concrete-by-version; the comment above shows the shape without binding
	// the example to one specific Seal SDK version.
}

/**
 * Receipt parser. Duplicates `KeypairAdapter`'s internal logic. If you write
 * multiple custom adapters, factor this out.
 */
function parseTxReceipt(
	tx: SuiClientTypes.Transaction<{ effects: true; objectTypes: true }>,
): TxReceipt {
	const effects = tx.effects;
	if (!effects) {
		throw new TransportError(
			"transaction effects missing despite include flag",
		);
	}
	const objectTypes = tx.objectTypes ?? {};
	return {
		digest: tx.digest,
		gasUsedMist: computeGasUsedMist(effects.gasUsed),
		createdObjects: collectCreated(effects.changedObjects, objectTypes),
		deletedObjects: collectDeleted(effects.changedObjects),
	};
}

function computeGasUsedMist(gas: SuiClientTypes.GasCostSummary): bigint {
	return (
		BigInt(gas.computationCost) +
		BigInt(gas.storageCost) -
		BigInt(gas.storageRebate)
	);
}

function collectCreated(
	changes: readonly SuiClientTypes.ChangedObject[],
	objectTypes: Record<string, string>,
): TxCreatedObject[] {
	const out: TxCreatedObject[] = [];
	for (const change of changes) {
		if (change.idOperation !== "Created") continue;
		const objectType = objectTypes[change.objectId];
		if (objectType === undefined) continue;
		out.push({
			objectId: toSuiObjectId(change.objectId),
			objectType,
		});
	}
	return out;
}

function collectDeleted(
	changes: readonly SuiClientTypes.ChangedObject[],
): TxDeletedObject[] {
	const out: TxDeletedObject[] = [];
	for (const change of changes) {
		if (change.idOperation !== "Deleted") continue;
		out.push({ objectId: toSuiObjectId(change.objectId) });
	}
	return out;
}

function failedTransactionMessage(
	failed: SuiClientTypes.Transaction<{ effects: true }>,
): string {
	const error = failed.effects?.status?.error;
	if (error) {
		return `transaction failed: ${error.message}`;
	}
	return "transaction failed without effects status";
}

// Type-only re-exports so this file reads as the consumer's checkpoint of
// what types they need from morse-sdk to write a custom adapter.
export type _ObjectReader = ObjectReader;
export type _SuiObjectId = SuiObjectId;
