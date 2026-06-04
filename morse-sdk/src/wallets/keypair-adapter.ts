/**
 * Wallet adapter that signs with a local Sui keypair. Suitable for servers,
 * CLIs, scripts, and tests; not suitable for browser apps that should defer
 * signing to a user-controlled wallet.
 */

import { SimulationError, type SuiClientTypes } from "@mysten/sui/client";
import type { Signer } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { Transaction } from "@mysten/sui/transactions";

import type { TransactionExecutor } from "../clients.js";
import { toSuiAddress, toSuiObjectId } from "../codecs.js";
import {
	type AbortModule,
	ContractAbortError,
	TransportError,
} from "../errors.js";
import type {
	SuiAddress,
	TxCreatedObject,
	TxDeletedObject,
	TxReceipt,
} from "../types.js";
import type { SimulationReturnValues, WalletAdapter } from "./adapter.js";

type TxInclude = { effects: true; objectTypes: true };

type TxResult = SuiClientTypes.TransactionResult<TxInclude>;

type SimInclude = { effects: true; commandResults: true };

type SimResult = SuiClientTypes.SimulateTransactionResult<SimInclude>;

const TX_INCLUDE: TxInclude = { effects: true, objectTypes: true };

const SIM_INCLUDE: SimInclude = { effects: true, commandResults: true };

const KNOWN_ABORT_MODULES: ReadonlySet<AbortModule> = new Set([
	"publication",
	"collection",
	"entry",
	"allowlist",
	"file",
]);

/**
 * Wallet adapter wrapping a `@mysten/sui` `Signer` (any keypair) plus a
 * narrow client. Submits transactions, normalizes effects into a `TxReceipt`,
 * and maps Move aborts to `ContractAbortError`.
 */
export class KeypairAdapter implements WalletAdapter {
	readonly address: SuiAddress;

	constructor(
		private readonly signer: Signer,
		private readonly client: TransactionExecutor,
	) {
		this.address = toSuiAddress(signer.toSuiAddress());
	}

	/**
	 * Construct from a raw secret key (Bech32 string or 32-byte `Uint8Array`).
	 * Convenience for CLIs and scripts; uses Ed25519.
	 */
	static fromSecretKey(
		secretKey: Uint8Array | string,
		client: TransactionExecutor,
	): KeypairAdapter {
		return new KeypairAdapter(Ed25519Keypair.fromSecretKey(secretKey), client);
	}

	async signAndExecuteTransaction(
		tx: Transaction,
		signal?: AbortSignal,
	): Promise<TxReceipt> {
		const submitted = await this.submit(tx, signal);
		const final = await this.waitForFinality(submitted, signal);
		return parseReceipt(final);
	}

	async simulateTransaction(
		tx: Transaction,
		signal?: AbortSignal,
	): Promise<SimulationReturnValues> {
		// `signAndExecuteTransaction` derives the sender from `signer`; the
		// simulate path does not, so callers would otherwise get a zero-address
		// sender and the simulator would reject any owned-object references.
		tx.setSenderIfNotSet(this.address);
		const result = await callClient("simulateTransaction", () =>
			this.client.simulateTransaction({
				transaction: tx,
				include: SIM_INCLUDE,
				...(signal === undefined ? {} : { signal }),
			}),
		);
		if (result.$kind === "FailedTransaction") {
			throw mapFailedTransaction(result.FailedTransaction);
		}
		return parseSimulationReturnValues(result);
	}

	private async submit(
		tx: Transaction,
		signal: AbortSignal | undefined,
	): Promise<TxResult> {
		const result = await callClient("signAndExecuteTransaction", () =>
			this.client.signAndExecuteTransaction({
				signer: this.signer,
				transaction: tx,
				include: TX_INCLUDE,
				...(signal === undefined ? {} : { signal }),
			}),
		);
		if (result.$kind === "FailedTransaction") {
			throw mapFailedTransaction(result.FailedTransaction);
		}
		return result;
	}

	private async waitForFinality(
		submitted: TxResult,
		signal: AbortSignal | undefined,
	): Promise<TxResult> {
		const final = await callClient("waitForTransaction", () =>
			this.client.waitForTransaction({
				result: submitted,
				include: TX_INCLUDE,
				...(signal === undefined ? {} : { signal }),
			}),
		);
		if (final.$kind === "FailedTransaction") {
			throw mapFailedTransaction(final.FailedTransaction);
		}
		return final;
	}
}

async function callClient<T>(
	operation: string,
	call: () => Promise<T>,
): Promise<T> {
	try {
		return await call();
	} catch (cause) {
		const mapped = tryMapSimulationAbort(cause);
		if (mapped) {
			throw mapped;
		}
		throw new TransportError(`${operation} failed`, {
			cause,
			operation: `sui.${operation}`,
		});
	}
}

/**
 * The Sui gRPC client throws `SimulationError` when the transaction's pre-submit
 * dry-run hits a Move abort. The error carries an `executionError` with a
 * structured `MoveAbort`. Detect that and map to `ContractAbortError`; return
 * `null` for any other failure so the caller falls back to `TransportError`.
 */
function tryMapSimulationAbort(cause: unknown): ContractAbortError | null {
	if (!(cause instanceof SimulationError)) {
		return null;
	}
	const executionError = cause.executionError;
	if (!executionError) {
		return null;
	}
	const moveAbort = executionError.MoveAbort;
	if (!moveAbort) {
		return null;
	}
	return mapMoveAbortToContractAbortError(moveAbort);
}

function parseReceipt(final: TxResult): TxReceipt {
	if (final.$kind !== "Transaction") {
		throw new TransportError(
			"Transaction result missing after waitForTransaction",
			{ operation: "sui.waitForTransaction" },
		);
	}
	const tx = final.Transaction;
	const effects = tx.effects;
	if (!effects) {
		throw new TransportError(
			"Transaction effects missing; client did not return them despite include flag",
			{ operation: "sui.waitForTransaction" },
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
		if (change.idOperation !== "Created") {
			continue;
		}
		// Sui occasionally lists Created entries without type info (internal
		// or auxiliary objects). Skip those: the array only carries entries
		// the SDK can identify by type. Missing-by-type lookups surface
		// downstream via findCreatedId.
		const objectType = objectTypes[change.objectId];
		if (objectType === undefined) {
			continue;
		}
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
		if (change.idOperation !== "Deleted") {
			continue;
		}
		out.push({ objectId: toSuiObjectId(change.objectId) });
	}
	return out;
}

function mapFailedTransaction(
	failed: SuiClientTypes.Transaction<{ effects: true }>,
): Error {
	const status = failed.effects?.status;
	if (status && !status.success) {
		const moveAbort = status.error.MoveAbort;
		if (moveAbort) {
			const mapped = mapMoveAbortToContractAbortError(moveAbort);
			if (mapped) {
				return mapped;
			}
		}
		return new TransportError(
			`Transaction execution failed: ${status.error.message}`,
			{ operation: "sui.executeTransaction" },
		);
	}
	return new TransportError("Transaction failed without effects status", {
		operation: "sui.executeTransaction",
	});
}

/**
 * Map a `MoveAbort` proto shape (from either a SimulationError's
 * `executionError` or a FailedTransaction's `effects.status.error`) to a
 * `ContractAbortError`, or `null` if the module is not one this SDK recognizes
 * or the abort code is malformed. Callers fall back to `TransportError` on `null`.
 */
function mapMoveAbortToContractAbortError(
	moveAbort: SuiClientTypes.MoveAbort,
): ContractAbortError | null {
	const moduleName = moveAbort.location?.module;
	const code = Number(moveAbort.abortCode);
	if (
		moduleName !== undefined &&
		isKnownAbortModule(moduleName) &&
		Number.isFinite(code)
	) {
		return ContractAbortError.fromAbortCode(moduleName, code);
	}
	return null;
}

function isKnownAbortModule(name: string): name is AbortModule {
	return KNOWN_ABORT_MODULES.has(name as AbortModule);
}

function parseSimulationReturnValues(
	result: SimResult,
): SimulationReturnValues {
	if (result.$kind !== "Transaction") {
		throw new TransportError("Simulate did not return a Transaction result", {
			operation: "sui.simulateTransaction",
		});
	}
	const commandResults = result.commandResults;
	if (!commandResults) {
		throw new TransportError(
			"Simulation result missing commandResults despite include flag",
			{ operation: "sui.simulateTransaction" },
		);
	}
	return commandResults.map((cmd) => cmd.returnValues.map((rv) => rv.bcs));
}
