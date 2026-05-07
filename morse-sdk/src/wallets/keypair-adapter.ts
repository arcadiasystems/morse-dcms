/**
 * Wallet adapter that signs with a local Sui keypair. Suitable for servers,
 * CLIs, scripts, and tests; not suitable for browser apps that should defer
 * signing to a user-controlled wallet.
 */

import type { SuiClientTypes } from "@mysten/sui/client";
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
import type { WalletAdapter } from "./adapter.js";

type TxInclude = { effects: true; objectTypes: true };

type TxResult = SuiClientTypes.TransactionResult<TxInclude>;

const TX_INCLUDE: TxInclude = { effects: true, objectTypes: true };

const KNOWN_ABORT_MODULES: ReadonlySet<AbortModule> = new Set([
	"publication",
	"collection",
	"entry",
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
		throw new TransportError(`${operation} failed`, { cause });
	}
}

function parseReceipt(final: TxResult): TxReceipt {
	if (final.$kind !== "Transaction") {
		throw new TransportError(
			"Transaction result missing after waitForTransaction",
		);
	}
	const tx = final.Transaction;
	const effects = tx.effects;
	if (!effects) {
		throw new TransportError(
			"Transaction effects missing; client did not return them despite include flag",
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
	failed: SuiClientTypes.Transaction<TxInclude>,
): Error {
	const status = failed.effects?.status;
	if (status && !status.success) {
		const moveAbort = status.error.MoveAbort;
		if (moveAbort) {
			const moduleName = moveAbort.location?.module;
			const code = Number(moveAbort.abortCode);
			if (
				moduleName !== undefined &&
				isKnownAbortModule(moduleName) &&
				Number.isFinite(code)
			) {
				return ContractAbortError.fromAbortCode(moduleName, code);
			}
		}
		return new TransportError(
			`Transaction execution failed: ${status.error.message}`,
		);
	}
	return new TransportError("Transaction failed without effects status");
}

function isKnownAbortModule(name: string): name is AbortModule {
	return KNOWN_ABORT_MODULES.has(name as AbortModule);
}
