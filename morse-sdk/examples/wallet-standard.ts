/**
 * Browser wallet integration via the wallet-standard protocol.
 *
 * Two pieces collaborate:
 *
 * - `WalletStandardAdapter` (this file) — implements morse-sdk's
 *   `WalletAdapter` interface. Wraps a wallet's `signAndExecuteTransaction`
 *   callback so morse-sdk ops (createPublication, addEntry, etc.) work in a
 *   browser without a private key.
 *
 * - `WalletStandardSigner` (shipped from `morse-sdk`) — subclasses Sui's
 *   `Signer` abstract by wrapping a wallet's `signTransaction` and
 *   `signPersonalMessage` callbacks. Pass it to `@mysten/walrus`'s
 *   `WalrusClient` (via `DefaultWalrusWriteAdapter.fromConfig`) and to
 *   `@mysten/seal`'s `SessionKey.create`. The user's key never leaves the
 *   wallet.
 *
 * In a real React app those callbacks come from `@mysten/dapp-kit`'s
 * `useSignAndExecuteTransaction`, `useSignTransaction`, and
 * `useSignPersonalMessage` hooks. See `examples/wallet-standard-react.md`
 * for the full provider + hook wiring.
 *
 * Function and value names in this file are illustrative.
 */

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
} from "@arcadiasystems/morse-sdk";
import type { SuiClientTypes } from "@mysten/sui/client";
import type { Transaction } from "@mysten/sui/transactions";

/**
 * Shape returned by the wallet-standard sign-and-execute API. Matches
 * dapp-kit's `useSignAndExecuteTransaction().mutateAsync` when invoked
 * with `{ transaction }`: the wallet signs, submits, and resolves with the
 * digest.
 */
export type WalletSignAndExecute = (input: {
	transaction: Transaction;
}) => Promise<{ digest: string }>;

/**
 * `WalletAdapter` against a wallet-standard signer. Used for morse-sdk's
 * own ops surface (createPublication, addEntry, transferOwnership, etc.).
 * For Walrus uploads and Seal SessionKey, wrap the same wallet in
 * `WalletStandardSigner` (from `morse-sdk`) and pass that.
 *
 * The receipt-parsing helpers below mirror `KeypairAdapter`'s internal
 * logic. If you implement multiple custom adapters in production, factor
 * them out.
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
			throw new TransportError(
				`wallet sign-and-execute failed: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause },
			);
		}

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
