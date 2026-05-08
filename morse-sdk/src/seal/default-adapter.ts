/**
 * Default `SealAdapter` wrapping `@mysten/seal`'s `SealClient`. Constructed
 * once with the morse package id (which Seal embeds into ciphertext
 * envelopes), the key-server list, and the TSS threshold. Threshold lives on
 * the config rather than per-call: ciphertexts encoded under one threshold
 * are not decryptable under another, so per-call thresholds would
 * silently break recoverability when changed.
 */

import {
	DecryptionError,
	ExpiredSessionKeyError,
	InvalidCiphertextError,
	type KeyServerConfig,
	NoAccessError,
	SealClient,
	type SealCompatibleClient,
	type SessionKey,
	TooManyFailedFetchKeyRequestsError,
} from "@mysten/seal";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";

import {
	ConfigurationError,
	SealError,
	TransportError,
	ValidationError,
} from "../errors.js";
import type {
	PackageId,
	PublicationId,
	PublisherCapId,
	SealId,
} from "../types.js";
import type {
	SealAdapter,
	SealDecryptOptions,
	SealEncryptOptions,
	SealEncryptResult,
} from "./adapter.js";
import { decodePublisherSealId } from "./identity.js";

/**
 * Configuration for `DefaultSealAdapter`. `packageId` MUST be the deployment's
 * `originalPackageId`: Seal binds the package address into ciphertext
 * envelopes and into key-server proofs, so a post-upgrade `packageId` would
 * make pre-upgrade ciphertexts undecryptable.
 */
export interface SealAdapterConfig {
	readonly packageId: PackageId;
	readonly serverConfigs: readonly KeyServerConfig[];
	readonly threshold: number;
	readonly verifyKeyServers?: boolean;
	readonly timeout?: number;
}

/** Narrow structural slice of `SealClient` actually used by the adapter. */
interface SealClientLike {
	encrypt(args: {
		threshold: number;
		packageId: string;
		id: string;
		data: Uint8Array;
		aad?: Uint8Array;
	}): Promise<{ encryptedObject: Uint8Array; key: Uint8Array }>;
	decrypt(args: {
		data: Uint8Array;
		sessionKey: SessionKey;
		txBytes: Uint8Array;
	}): Promise<Uint8Array>;
}

interface DefaultSealAdapterOptions {
	readonly client: SealClientLike;
	readonly suiClient: SealCompatibleClient;
	readonly packageId: PackageId;
	readonly threshold: number;
}

/** `SealAdapter` implementation backed by `@mysten/seal`. */
export class DefaultSealAdapter implements SealAdapter {
	private readonly client: SealClientLike;
	private readonly suiClient: SealCompatibleClient;
	private readonly packageId: PackageId;
	private readonly threshold: number;

	constructor(options: DefaultSealAdapterOptions) {
		this.client = options.client;
		this.suiClient = options.suiClient;
		this.packageId = options.packageId;
		this.threshold = options.threshold;
	}

	/**
	 * Build an adapter from a morse package config (typically
	 * `morseConfig({ network })`). Defaults `serverConfigs` from
	 * `morseConfig.sealKeyServers` (the canonical testnet allowlist baked
	 * into morse-sdk) when omitted; defaults `threshold` to
	 * `min(2, serverConfigs.length)` when omitted. Picks
	 * `originalPackageId ?? packageId` internally; passing a post-upgrade
	 * `packageId` directly would silently produce ciphertexts that become
	 * undecryptable across upgrades.
	 *
	 * Pass `seal: {}` for the default path; supply `serverConfigs` when you
	 * want a custom set (paid plans, alternate trust assumptions, region
	 * pinning), or `threshold` when you want a non-default TSS shape.
	 *
	 * @throws {ConfigurationError} If neither `seal.serverConfigs` nor
	 *   `morseConfig.sealKeyServers` provide any servers (e.g. mainnet
	 *   pre-freeze).
	 */
	static fromMorseConfig(
		morseConfig: {
			packageId: PackageId;
			originalPackageId?: PackageId;
			sealKeyServers?: readonly KeyServerConfig[];
		},
		seal: Partial<Omit<SealAdapterConfig, "packageId">>,
		suiClient: SealCompatibleClient,
	): DefaultSealAdapter {
		const serverConfigs =
			seal.serverConfigs ?? morseConfig.sealKeyServers ?? [];
		if (serverConfigs.length === 0) {
			throw new ConfigurationError(
				"morseConfig has no canonical Seal key servers for this network and no override was supplied. Pass seal.serverConfigs explicitly, or use a network where the allowlist is pinned.",
			);
		}
		const threshold = seal.threshold ?? Math.min(2, serverConfigs.length);
		return DefaultSealAdapter.fromConfig(
			{
				packageId: morseConfig.originalPackageId ?? morseConfig.packageId,
				serverConfigs,
				threshold,
				...(seal.verifyKeyServers === undefined
					? {}
					: { verifyKeyServers: seal.verifyKeyServers }),
				...(seal.timeout === undefined ? {} : { timeout: seal.timeout }),
			},
			suiClient,
		);
	}

	/**
	 * Build an adapter from a `SealAdapterConfig` and a Sui-compatible client
	 * (a `SuiGrpcClient` satisfies the `SealCompatibleClient` shape). Use
	 * `fromMorseConfig` instead when you have a `morseConfig({network})`.
	 */
	static fromConfig(
		config: SealAdapterConfig,
		suiClient: SealCompatibleClient,
	): DefaultSealAdapter {
		if (config.serverConfigs.length === 0) {
			throw new ValidationError(
				"SealAdapterConfig.serverConfigs must contain at least one entry",
				"serverConfigs",
			);
		}
		if (
			!Number.isInteger(config.threshold) ||
			config.threshold < 1 ||
			config.threshold > config.serverConfigs.length
		) {
			throw new ValidationError(
				`SealAdapterConfig.threshold must be an integer in [1, ${config.serverConfigs.length}]; got ${config.threshold}`,
				"threshold",
			);
		}
		const client = new SealClient({
			suiClient,
			serverConfigs: [...config.serverConfigs],
			...(config.verifyKeyServers === undefined
				? {}
				: { verifyKeyServers: config.verifyKeyServers }),
			...(config.timeout === undefined ? {} : { timeout: config.timeout }),
		});
		return new DefaultSealAdapter({
			client,
			suiClient,
			packageId: config.packageId,
			threshold: config.threshold,
		});
	}

	async encrypt(
		plaintext: Uint8Array,
		options: SealEncryptOptions,
	): Promise<SealEncryptResult> {
		const id = bytesToHex(options.sealId);
		const result = await runSealCall(() =>
			this.client.encrypt({
				threshold: this.threshold,
				packageId: this.packageId,
				id,
				data: plaintext,
				...(options.aad === undefined ? {} : { aad: options.aad }),
			}),
		);
		return { ciphertext: result.encryptedObject };
	}

	async decrypt(
		ciphertext: Uint8Array,
		options: SealDecryptOptions,
	): Promise<Uint8Array> {
		const { publicationId } = decodePublisherSealId(options.sealId);
		const txBytes = await this.buildSealApproveTxBytes(
			publicationId,
			options.publisherCapId,
			options.sealId,
			options.sessionKey,
		);
		return runSealCall(() =>
			this.client.decrypt({
				data: ciphertext,
				sessionKey: options.sessionKey,
				txBytes,
			}),
		);
	}

	private async buildSealApproveTxBytes(
		publicationId: PublicationId,
		publisherCapId: PublisherCapId,
		sealId: SealId,
		sessionKey: SessionKey,
	): Promise<Uint8Array> {
		const tx = new Transaction();
		tx.moveCall({
			target: `${this.packageId}::publication::seal_approve_publisher`,
			arguments: [
				tx.pure.vector("u8", Array.from(sealId)),
				tx.object(publicationId),
				tx.object(publisherCapId),
			],
		});
		tx.setSender(sessionKey.getAddress());
		try {
			return await tx.build({
				client: this.suiClient as unknown as ClientWithCoreApi,
				onlyTransactionKind: true,
			});
		} catch (cause) {
			throw new TransportError("Failed to build seal_approve PTB", { cause });
		}
	}
}

async function runSealCall<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (cause) {
		const mapped = mapSealError(cause);
		if (mapped) {
			throw mapped;
		}
		throw new TransportError(sealErrorMessage(cause), { cause });
	}
}

function mapSealError(cause: unknown): SealError | null {
	if (cause instanceof NoAccessError) {
		return new SealError("no-access", `Seal denied access: ${cause.message}`, {
			cause,
		});
	}
	if (cause instanceof ExpiredSessionKeyError) {
		return new SealError("session-expired", "Seal session key expired", {
			cause,
		});
	}
	if (cause instanceof TooManyFailedFetchKeyRequestsError) {
		return new SealError(
			"rate-limited",
			"Seal key servers rejected too many requests",
			{ cause },
		);
	}
	if (
		cause instanceof DecryptionError ||
		cause instanceof InvalidCiphertextError
	) {
		return new SealError(
			"decrypt-failed",
			`Seal decryption failed: ${cause.message}`,
			{ cause },
		);
	}
	return null;
}

function sealErrorMessage(cause: unknown): string {
	if (cause instanceof Error) {
		return `Seal call failed: ${cause.message}`;
	}
	return "Seal call failed";
}

function bytesToHex(bytes: Uint8Array): string {
	let hex = "0x";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}
