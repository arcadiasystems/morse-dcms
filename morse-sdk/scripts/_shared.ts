/**
 * Shared helpers for the smoke scripts. Bundles network resolution and
 * wallet/reader setup with the contract-required cleanup ordering:
 * `deleteEntry × N` then `deleteCollection × M` then `deletePublication`.
 * Skipping any layer leaves chain state that a later run cannot remove
 * without a separate repair script.
 */

import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import {
	type CreatePublicationResult,
	deleteCollection,
	deleteEntry,
	deletePublication,
	KeypairAdapter,
	morseConfig,
	type NetworkConfig,
	RpcPublicationReader,
} from "../src/index.js";

// Network selection

/** Networks the smokes can target. Walrus has no localnet deployment. */
export type SmokeNetwork = "mainnet" | "testnet";

/**
 * Resolve the target network from `MORSE_NETWORK`, defaulting to testnet.
 *
 * Mainnet additionally requires `MORSE_ALLOW_MAINNET=1`. These scripts spend
 * real SUI and WAL on mainnet and delete what they create, so the second
 * variable exists to make an exported-shell-variable accident impossible:
 * choosing mainnet has to be deliberate twice.
 */
export function smokeNetwork(): SmokeNetwork {
	const requested = process.env.MORSE_NETWORK ?? "testnet";
	if (requested === "testnet") {
		return "testnet";
	}
	if (requested === "mainnet") {
		if (process.env.MORSE_ALLOW_MAINNET !== "1") {
			console.error(
				"MORSE_NETWORK=mainnet requires MORSE_ALLOW_MAINNET=1. These smokes spend real SUI and WAL.",
			);
			process.exit(1);
		}
		return "mainnet";
	}
	console.error(
		`Unsupported MORSE_NETWORK "${requested}". Use mainnet or testnet (Walrus has no localnet).`,
	);
	process.exit(1);
}

/**
 * Build the `NetworkConfig` for the resolved network, honouring an optional
 * `SUI_RPC_URL` override. Pair with `smokeNetwork()` when a script also needs
 * the bare network name for a Walrus or Sui client.
 */
export function smokeConfig(network: SmokeNetwork): NetworkConfig {
	return morseConfig({
		network,
		...(process.env.SUI_RPC_URL ? { rpcUrl: process.env.SUI_RPC_URL } : {}),
	});
}

// IO helpers

/** Format a Mist amount as a SUI decimal string. */
export function formatMist(mist: bigint): string {
	const negative = mist < 0n;
	const abs = negative ? -mist : mist;
	const whole = abs / 1_000_000_000n;
	const frac = abs % 1_000_000_000n;
	const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
	const value = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
	return `${negative ? "-" : ""}${value} SUI`;
}

/** Read a required env var or exit. */
export function readEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
	return value;
}

/** Print a numbered step header. */
export function step(index: number, total: number, message: string): void {
	console.log(`[${index}/${total}] ${message}`);
}

/** Print an indented status line under the current step. */
export function done(message: string): void {
	console.log(`        ${message}`);
}

// Smoke setup + cleanup

export interface SmokeContext {
	readonly network: SmokeNetwork;
	readonly client: SuiGrpcClient;
	readonly adapter: KeypairAdapter;
	readonly keypair: Ed25519Keypair;
	readonly reader: RpcPublicationReader;
	readonly config: NetworkConfig;
}

/** Build the Sui client, wallet adapter, and reader from the standard env. */
export function buildSmokeContext(): SmokeContext {
	// Resolve the network before touching secrets: a bad MORSE_NETWORK should
	// fail without the caller having to supply a key first.
	const network = smokeNetwork();
	const privateKey = readEnv("PRIVATE_KEY");
	const config = smokeConfig(network);
	const client = new SuiGrpcClient({
		network,
		baseUrl: config.rpcUrl,
	});
	const { scheme, secretKey } = decodeSuiPrivateKey(privateKey);
	if (scheme !== "ED25519") {
		throw new Error(`Smoke scripts require an Ed25519 key; got ${scheme}`);
	}
	const keypair = Ed25519Keypair.fromSecretKey(secretKey);
	const adapter = new KeypairAdapter(keypair, client);
	const reader = RpcPublicationReader.fromMorseConfig(config, client);
	return { network, client, adapter, keypair, reader, config };
}

export interface CleanupTarget {
	readonly created: CreatePublicationResult;
	/** Names of collections that were created and need deletion. */
	readonly collectionNames: readonly string[];
	/** Per-collection entry IDs to delete first. */
	readonly entryIdsByCollection: ReadonlyMap<string, readonly number[]>;
}

/**
 * Tear down everything in the order the Move layer requires: entries first,
 * then collections, then the publication. Each step's failure is logged but
 * does not stop the others from running.
 */
export async function cleanupSmokePublication(
	ctx: SmokeContext,
	target: CleanupTarget,
): Promise<void> {
	console.log("\n  Cleaning up...");
	for (const collectionName of target.collectionNames) {
		const entryIds = target.entryIdsByCollection.get(collectionName) ?? [];
		for (const entryId of entryIds) {
			try {
				const r = await deleteEntry(ctx.adapter, ctx.config, {
					publicationId: target.created.publicationId,
					publisherCapId: target.created.publisherCapId,
					collectionName,
					entryId,
				});
				console.log(
					`    deleted entry ${collectionName}:${entryId} (gas=${formatMist(r.gasUsedMist)})`,
				);
			} catch (error) {
				console.error(
					`    failed to delete entry ${collectionName}:${entryId}:`,
					error,
				);
			}
		}
		try {
			const r = await deleteCollection(ctx.adapter, ctx.config, {
				publicationId: target.created.publicationId,
				publisherCapId: target.created.publisherCapId,
				name: collectionName,
			});
			console.log(
				`    deleted collection ${collectionName} (gas=${formatMist(r.gasUsedMist)})`,
			);
		} catch (error) {
			console.error(
				`    failed to delete collection ${collectionName}:`,
				error,
			);
		}
	}
	try {
		const r = await deletePublication(ctx.reader, ctx.adapter, ctx.config, {
			publicationId: target.created.publicationId,
			ownerCapId: target.created.ownerCapId,
		});
		console.log(`    deleted publication (gas=${formatMist(r.gasUsedMist)})`);
	} catch (error) {
		console.error(`    failed to delete publication:`, error);
	}
}
