/**
 * The single place that builds SDK clients from resolved settings and the key
 * source. `buildReadContext` covers reads; `buildWriteContext` adds a signing
 * adapter by unlocking the active account.
 */

import {
	buildRecipientFileEventTypes,
	DefaultSealAdapter,
	DefaultWalrusReadAdapter,
	DefaultWalrusWriteAdapter,
	HttpAggregatorReadAdapter,
	KeypairAdapter,
	morseConfig,
	type NetworkConfig,
	type RecipientFileEventTypes,
	RpcPublicationReader,
	RpcRecipientFilesReader,
	type SuiAddress,
	type WalrusReadAdapter,
} from "@arcadiasystems/morse-sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { Command } from "commander";
import { type ResolvedSettings, resolveSettings } from "../config/profile.ts";
import { loadConfig } from "../config/store.ts";
import { accountAddress, resolveSigner } from "../keystore/source.ts";
import { CliError } from "./errors.ts";
import type { EventQuerier } from "./events.ts";
import { ExitCode } from "./exit-codes.ts";
import type { Output } from "./output.ts";
import { sigintSignal } from "./prompts.ts";
import { globalOptions, outputFor } from "./runtime.ts";

export interface ReadContext {
	readonly output: Output;
	readonly settings: ResolvedSettings;
	readonly config: NetworkConfig;
	readonly client: SuiGrpcClient;
	readonly reader: RpcPublicationReader;
	readonly ownerAddress: SuiAddress | undefined;
	readonly signal: AbortSignal;
}

export async function buildReadContext(command: Command): Promise<ReadContext> {
	const opts = globalOptions(command);
	const output = outputFor(command);
	const settings = resolveSettings(opts, await loadConfig());
	const config = morseConfig({
		network: settings.network,
		...(settings.rpcUrl === undefined ? {} : { rpcUrl: settings.rpcUrl }),
	});
	const client = new SuiGrpcClient({
		network: settings.network,
		baseUrl: config.rpcUrl,
	});
	const reader = RpcPublicationReader.fromMorseConfig(config, client);
	return {
		output,
		settings,
		config,
		client,
		reader,
		ownerAddress: accountAddress(settings.account),
		signal: sigintSignal(),
	};
}

export interface WriteContext extends ReadContext {
	readonly adapter: KeypairAdapter;
	readonly address: SuiAddress;
}

interface SignedBase {
	readonly base: ReadContext;
	readonly keypair: Ed25519Keypair;
	readonly address: SuiAddress;
}

async function buildSignedBase(command: Command): Promise<SignedBase> {
	const base = await buildReadContext(command);
	const signer = await resolveSigner(
		base.settings.account,
		process.env,
		base.signal,
	);
	return { base, keypair: signer.keypair, address: signer.address };
}

export async function buildWriteContext(
	command: Command,
): Promise<WriteContext> {
	const { base, keypair, address } = await buildSignedBase(command);
	return {
		...base,
		adapter: new KeypairAdapter(keypair, base.client),
		address,
	};
}

// The recipient-files domain uses a separate reader from publications; it is
// type-filtered on the recipient-file origin package id.
export interface FilesReadContext extends ReadContext {
	readonly filesReader: RpcRecipientFilesReader;
}

export async function buildFilesReadContext(
	command: Command,
): Promise<FilesReadContext> {
	const base = await buildReadContext(command);
	return {
		...base,
		filesReader: RpcRecipientFilesReader.fromConfig(base.client, {
			packageId: base.config.packageId,
		}),
	};
}

export interface ContentContext extends WriteContext {
	readonly walrus: DefaultWalrusWriteAdapter;
}

export async function buildContentContext(
	command: Command,
): Promise<ContentContext> {
	const { base, keypair, address } = await buildSignedBase(command);
	const network = base.settings.network;
	if (network === "localnet") {
		throw new CliError(
			"Walrus content uploads are not available on localnet. Use testnet or mainnet.",
			ExitCode.Usage,
		);
	}
	const adapter = new KeypairAdapter(keypair, base.client);
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network, suiClient: base.client },
		keypair,
	);
	return { ...base, adapter, address, walrus };
}

export interface EncryptContext extends ContentContext {
	readonly seal: DefaultSealAdapter;
}

export async function buildEncryptContext(
	command: Command,
): Promise<EncryptContext> {
	const ctx = await buildContentContext(command);
	const seal = DefaultSealAdapter.fromMorseConfig(ctx.config, {}, ctx.client);
	return { ...ctx, seal };
}

/** Options shared by the content-read context builders. */
export interface ReadAdapterOptions {
	/** Read via the Walrus aggregator HTTP service instead of storage nodes. */
	readonly viaAggregator?: boolean;
}

/**
 * Build the Walrus read adapter. The default is the storage-node protocol,
 * which reconstructs and verifies the blob against its on-chain id; the
 * aggregator path trades that verification for a single operator-run endpoint
 * that often stays available when the node fan-out is flaky.
 */
function walrusReadAdapter(
	base: ReadContext,
	network: "testnet" | "mainnet",
	viaAggregator: boolean,
): WalrusReadAdapter {
	if (viaAggregator) {
		return HttpAggregatorReadAdapter.fromMorseConfig(base.config, base.client);
	}
	return DefaultWalrusReadAdapter.fromConfig({
		network,
		suiClient: base.client,
	});
}

export interface ReadContentContext extends ReadContext {
	readonly walrusRead: WalrusReadAdapter;
}

export async function buildReadContentContext(
	command: Command,
	opts: ReadAdapterOptions = {},
): Promise<ReadContentContext> {
	const base = await buildReadContext(command);
	const network = base.settings.network;
	if (network === "localnet") {
		throw new CliError(
			"Walrus reads are not available on localnet. Use testnet or mainnet.",
			ExitCode.Usage,
		);
	}
	return {
		...base,
		walrusRead: walrusReadAdapter(base, network, Boolean(opts.viaAggregator)),
	};
}

export interface DecryptContext extends ReadContext {
	readonly keypair: Ed25519Keypair;
	readonly address: SuiAddress;
	readonly seal: DefaultSealAdapter;
	readonly walrusRead: WalrusReadAdapter;
}

export async function buildDecryptContext(
	command: Command,
	opts: ReadAdapterOptions = {},
): Promise<DecryptContext> {
	const { base, keypair, address } = await buildSignedBase(command);
	const network = base.settings.network;
	if (network === "localnet") {
		throw new CliError(
			"Seal decryption is not available on localnet. Use testnet or mainnet.",
			ExitCode.Usage,
		);
	}
	const seal = DefaultSealAdapter.fromMorseConfig(base.config, {}, base.client);
	return {
		...base,
		keypair,
		address,
		seal,
		walrusRead: walrusReadAdapter(base, network, Boolean(opts.viaAggregator)),
	};
}

// Files download: read the file metadata and bytes without a key (public files
// need no signer), unlocking a signer lazily only when an encrypted file
// requires a SessionKey for decryption.
export interface FileDownloadContext extends FilesReadContext {
	readonly walrusRead: WalrusReadAdapter;
	readonly seal: DefaultSealAdapter;
	readonly unlockSigner: () => Promise<{
		keypair: Ed25519Keypair;
		address: SuiAddress;
	}>;
}

export async function buildFileDownloadContext(
	command: Command,
	opts: ReadAdapterOptions = {},
): Promise<FileDownloadContext> {
	const base = await buildReadContext(command);
	const network = base.settings.network;
	if (network === "localnet") {
		throw new CliError(
			"Walrus reads are not available on localnet. Use testnet or mainnet.",
			ExitCode.Usage,
		);
	}
	return {
		...base,
		filesReader: RpcRecipientFilesReader.fromConfig(base.client, {
			packageId: base.config.packageId,
		}),
		walrusRead: walrusReadAdapter(base, network, Boolean(opts.viaAggregator)),
		seal: DefaultSealAdapter.fromMorseConfig(base.config, {}, base.client),
		unlockSigner: () =>
			resolveSigner(base.settings.account, process.env, base.signal),
	};
}

// File listing: an event source (JSON-RPC suix_queryEvents, or a --indexer-url
// override) plus the morse event-type strings, fed into the SDK's pure reconcile
// helpers. Carries the files reader too, for --hydrate.
export interface FileListContext extends FilesReadContext {
	readonly events: EventQuerier;
	readonly eventTypes: RecipientFileEventTypes;
}

export async function buildFileListContext(
	command: Command,
	opts: { indexerUrl?: string } = {},
): Promise<FileListContext> {
	const base = await buildReadContext(command);
	const originPackageId = base.config.recipientFileEventOriginPackageId;
	if (originPackageId === undefined) {
		throw new CliError(
			"File listing is unavailable on this network: no recipientFileEventOriginPackageId in the config. Use testnet, or supply a config that sets it.",
			ExitCode.Usage,
		);
	}
	const events = new SuiJsonRpcClient({
		network: base.settings.network,
		url: opts.indexerUrl ?? base.config.rpcUrl,
	});
	return {
		...base,
		filesReader: RpcRecipientFilesReader.fromConfig(base.client, {
			packageId: base.config.packageId,
		}),
		// queryEvents satisfies EventQuerier structurally; the only divergence is
		// the opaque pagination cursor, which the paginator round-trips untouched.
		events: events as unknown as EventQuerier,
		eventTypes: buildRecipientFileEventTypes(originPackageId),
	};
}
