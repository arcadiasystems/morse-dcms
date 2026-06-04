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
	RecipientFileId,
	SealId,
} from "../types.js";
import type {
	SealAdapter,
	SealDecryptOptions,
	SealDecryptUnderRecipientFileOptions,
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
	/**
	 * Package id used as the target of `seal_approve*` PTBs. Defaults to
	 * `packageId` when omitted. Must be set explicitly when the seal_approve
	 * function lives in a module added in a package upgrade (e.g.
	 * `recipient_file::seal_approve` was introduced in v3 and only exists at
	 * the v3 published-at address; calling it at the original-id fails because
	 * that address only has v1 bytecode). For backwards compat with the
	 * publisher policy (introduced in v1, present at all upgrade addresses),
	 * omit this field.
	 */
	readonly targetPackageId?: PackageId;
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
	readonly targetPackageId: PackageId;
	readonly threshold: number;
}

/** `SealAdapter` implementation backed by `@mysten/seal`. */
export class DefaultSealAdapter implements SealAdapter {
	private readonly client: SealClientLike;
	private readonly suiClient: SealCompatibleClient;
	private readonly packageId: PackageId;
	private readonly targetPackageId: PackageId;
	private readonly threshold: number;

	constructor(options: DefaultSealAdapterOptions) {
		this.client = options.client;
		this.suiClient = options.suiClient;
		this.packageId = options.packageId;
		this.targetPackageId = options.targetPackageId;
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
				// Identity binding uses the original-id for crypto stability across
				// upgrades. Ciphertexts encrypted under v1's package id remain
				// decryptable after v2 / v3 upgrades.
				packageId: morseConfig.originalPackageId ?? morseConfig.packageId,
				// PTB targets use the current published-at because seal_approve
				// functions in modules added by upgrades (e.g. allowlist) only
				// exist at the current address. The publisher-policy
				// seal_approve_publisher (defined in v1) is reachable at either
				// the original-id or the current id; using the current id is
				// safe for both cases.
				targetPackageId: morseConfig.packageId,
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
			targetPackageId: config.targetPackageId ?? config.packageId,
			threshold: config.threshold,
		});
	}

	async encrypt(
		plaintext: Uint8Array,
		options: SealEncryptOptions,
	): Promise<SealEncryptResult> {
		const id = bytesToHex(options.sealId);
		const result = await runSealCall(
			() =>
				this.client.encrypt({
					threshold: this.threshold,
					packageId: this.packageId,
					id,
					data: plaintext,
					...(options.aad === undefined ? {} : { aad: options.aad }),
				}),
			"seal.encrypt",
		);
		return { ciphertext: result.encryptedObject };
	}

	async decrypt(
		ciphertext: Uint8Array,
		options: SealDecryptOptions,
	): Promise<Uint8Array> {
		// `decodePublisherSealId` throws `ValidationError` on a malformed or
		// tampered `SealId` (unknown policy tag). On-chain bytes are
		// contract-enforced, but `Revision.sealId` from a reader brands the
		// payload without re-validating client-side, and a hostile indexer
		// could surface arbitrary bytes. Rewrap as `SealError("decrypt-failed")`
		// so the throw matches `SealAdapter.decrypt`'s documented error contract.
		let publicationId: PublicationId;
		try {
			({ publicationId } = decodePublisherSealId(options.sealId));
		} catch (cause) {
			throw new SealError(
				"decrypt-failed",
				`Seal identity is malformed or uses an unsupported policy tag: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause },
			);
		}
		const txBytes = await this.buildSealApproveTxBytes(
			publicationId,
			options.publisherCapId,
			options.sealId,
			options.sessionKey,
		);
		return runSealCall(
			() =>
				this.client.decrypt({
					data: ciphertext,
					sessionKey: options.sessionKey,
					txBytes,
				}),
			"seal.decrypt",
		);
	}

	async decryptUnderRecipientFile(
		ciphertext: Uint8Array,
		options: SealDecryptUnderRecipientFileOptions,
	): Promise<Uint8Array> {
		// Unlike the publisher policy, the recipient-file seal identity is not
		// self-validating client-side: the prefix is an opaque caller-chosen
		// byte string bound to the file on chain via a dynamic field. The
		// `seal_approve_with_prefix` PTB dry-run is the only authoritative
		// check; we just forward the bytes and let Move (and Seal) verify.
		const txBytes = await this.buildRecipientFileApproveTxBytes(
			options.fileId,
			options.sealId,
			options.sessionKey,
		);
		return runSealCall(
			() =>
				this.client.decrypt({
					data: ciphertext,
					sessionKey: options.sessionKey,
					txBytes,
				}),
			"seal.decryptUnderRecipientFile",
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
			target: `${this.targetPackageId}::publication::seal_approve_publisher`,
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
			throw new TransportError("Failed to build seal_approve PTB", {
				cause,
				operation: "seal.buildApproveTx",
			});
		}
	}

	private async buildRecipientFileApproveTxBytes(
		fileId: RecipientFileId,
		sealId: SealId,
		sessionKey: SessionKey,
	): Promise<Uint8Array> {
		const tx = new Transaction();
		tx.moveCall({
			target: `${this.targetPackageId}::recipient_file::seal_approve_with_prefix`,
			arguments: [tx.pure.vector("u8", Array.from(sealId)), tx.object(fileId)],
		});
		tx.setSender(sessionKey.getAddress());
		try {
			return await tx.build({
				client: this.suiClient as unknown as ClientWithCoreApi,
				onlyTransactionKind: true,
			});
		} catch (cause) {
			throw new TransportError(
				"Failed to build recipient_file seal_approve_with_prefix PTB",
				{
					cause,
					operation: "seal.buildRecipientFileApproveTx",
				},
			);
		}
	}
}

async function runSealCall<T>(
	call: () => Promise<T>,
	operation = "seal.call",
): Promise<T> {
	try {
		return await call();
	} catch (cause) {
		const mapped = mapSealError(cause);
		if (mapped) {
			throw mapped;
		}
		throw new TransportError(sealErrorMessage(cause), { cause, operation });
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
