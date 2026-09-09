/**
 * Network configuration types, defaults, and the `morseConfig` factory that
 * hides deployed package addresses from consumers using known networks.
 */

import type { KeyServerConfig } from "@mysten/seal";

import { toPackageId, toRegistryId } from "./codecs.js";
import { ConfigurationError } from "./errors.js";
import type { PackageId, RegistryId } from "./types.js";

// Network

/** Supported Sui networks. */
export const Network = {
	Mainnet: "mainnet",
	Testnet: "testnet",
	Localnet: "localnet",
} as const;
export type Network = (typeof Network)[keyof typeof Network];

// Default RPC endpoints

/** Public Sui RPC endpoints per network. Override via `NetworkConfig.rpcUrl` if needed. */
export const DEFAULT_RPC_URLS: Readonly<Record<Network, string>> = {
	mainnet: "https://fullnode.mainnet.sui.io:443",
	testnet: "https://fullnode.testnet.sui.io:443",
	localnet: "http://127.0.0.1:9000",
};

// NetworkConfig

/**
 * Points the SDK at a Morse deployment. Values come from the deployment's
 * `Published.toml`.
 *
 * `packageId` is the `published-at` address (current upgrade) used as the
 * target of Move calls. `originalPackageId` is the `original-id` (genesis
 * publish address) used as the canonical type identity that Sui surfaces in
 * `objectType` strings and type filters; defaults to `packageId` when
 * omitted (correct for a fresh deploy with no upgrades). Swapping the two
 * values causes type-filter reads (e.g. `listPublicationsOwnedBy`) to return
 * empty.
 */
/**
 * Walrus aggregator / publisher HTTP endpoints. The aggregator URL is the
 * canonical Mysten-run service for the network; the publisher URL is left
 * undefined by default because publishers are operator-specific (paid
 * tiers, region pinning) and picking one for everyone is a trust decision
 * the SDK should not make. Consumers using a specific publisher supply
 * the URL explicitly via `morseConfig({ walrusEndpoints: { ... } })` or
 * pass it directly to `HttpPublisherWriteAdapter.fromConfig`.
 */
export interface WalrusEndpoints {
	/** Aggregator base URL for HTTP reads. No trailing slash. */
	readonly aggregator: string;
	/** Optional publisher base URL for HTTP writes. No trailing slash. */
	readonly publisher?: string;
}

export interface NetworkConfig {
	readonly network: Network;
	readonly rpcUrl: string;
	readonly packageId: PackageId;
	readonly originalPackageId?: PackageId;
	/**
	 * Package id where the `recipient_file::*` event structs were first
	 * defined. Used to construct fully-qualified event type strings
	 * (e.g. `${recipientFileEventOriginPackageId}::recipient_file::RecipientFileCreated`)
	 * for indexer queries. Distinct from `packageId` (current published-at,
	 * moves on every upgrade) and `originalPackageId` (publication-modules
	 * genesis). Update only when a future upgrade redefines the
	 * `recipient_file` module at a new address. Rare.
	 */
	readonly recipientFileEventOriginPackageId?: PackageId;
	readonly registryId: RegistryId;
	/**
	 * Canonical Seal threshold-encryption key servers for the network. Used by
	 * `DefaultSealAdapter.fromMorseConfig` when the consumer omits an explicit
	 * `serverConfigs`. Empty for networks with no pinned allowlist (localnet,
	 * custom deployments), which makes the encrypted paths throw
	 * `ConfigurationError` until the consumer supplies `serverConfigs`.
	 *
	 * Empty on mainnet by design: every mainnet operator is commercial, so
	 * there is nothing to default to. Supply `serverConfigs` yourself, or start
	 * from `MAINNET_SEAL_COMMITTEE` and add the credentials it documents.
	 *
	 * Entries are `@mysten/seal` `KeyServerConfig` objects and are passed
	 * through untouched. Seal distinguishes two server types and enforces the
	 * distinction at client construction: a committee-mode server REQUIRES
	 * `aggregatorUrl`, an independent server must NOT have it. Getting this
	 * wrong surfaces as `InvalidClientOptionsError` at runtime, not at compile
	 * time, so `config.test.ts` guards both directions.
	 */
	readonly sealKeyServers: readonly KeyServerConfig[];
	/**
	 * Canonical Walrus HTTP endpoints for the network. Used by
	 * `HttpAggregatorReadAdapter.fromMorseConfig` (and the future publisher
	 * equivalent when a "canonical" publisher exists). Aggregator is pinned
	 * to Mysten's service for the network; publisher is intentionally left
	 * undefined - pass `walrusEndpoints.publisher` to override.
	 */
	readonly walrusEndpoints: WalrusEndpoints;
}

/**
 * Subset of `NetworkConfig` used by ops that touch only the package (cap and
 * collection ops). Excludes `registryId`, which only registry-aware ops
 * (publication creation/deletion) need.
 */
export type MorsePackageConfig = Pick<
	NetworkConfig,
	"packageId" | "originalPackageId"
>;

/**
 * Config shape for recipient-file ops and reader. Extends `MorsePackageConfig`
 * with `recipientFileEventOriginPackageId`, which is needed for created-object
 * type-string lookup: Sui stamps a created object's type with the package id
 * where its struct was FIRST defined, not the current published-at. For
 * `RecipientFile` that's the v3 upgrade address; matching against the current
 * `packageId` (v4+) fails. When omitted, defaults to `packageId` (correct for
 * a fresh deployment with no upgrades).
 */
export type MorseRecipientFileConfig = MorsePackageConfig &
	Pick<NetworkConfig, "recipientFileEventOriginPackageId">;

// morseConfig factory

/**
 * Mysten's decentralized Seal committee on mainnet, as a ready-made
 * `sealKeyServers` value. NOT a default: the aggregator is a credentialed
 * service that answers 401 to unauthenticated requests, so this only works
 * once you add the `apiKeyName` and `apiKey` Mysten issues you.
 *
 * Committee mode is one logical server fronting 8 operators with an internal
 * 5-of-8 quorum, which is why `aggregatorUrl` is required (Seal throws
 * `InvalidClientOptionsError` without it) and why a single entry of weight 1
 * is the correct shape. `DefaultSealAdapter.fromMorseConfig` then resolves
 * threshold to 1; the real quorum lives behind the aggregator and is not
 * something this SDK can express as a share count.
 *
 * @example
 * const config = morseConfig({
 *   network: "mainnet",
 *   sealKeyServers: MAINNET_SEAL_COMMITTEE.map((s) => ({
 *     ...s,
 *     apiKeyName: "x-api-key",
 *     apiKey: process.env.SEAL_API_KEY,
 *   })),
 * });
 */
export const MAINNET_SEAL_COMMITTEE: readonly KeyServerConfig[] = [
	{
		objectId:
			"0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595",
		weight: 1,
		aggregatorUrl: "https://seal-aggregator-mainnet.mystenlabs.com",
	},
];

/**
 * Canonical Morse deployment addresses per network. Mirrors
 * `morse-contracts/Published.toml`; update on every contract publish or
 * upgrade. Networks absent from this map require explicit `packageId` and
 * `registryId` overrides.
 */
const KNOWN_DEPLOYMENTS: Partial<
	Record<
		Network,
		{
			readonly packageId: PackageId;
			readonly originalPackageId: PackageId;
			readonly recipientFileEventOriginPackageId: PackageId;
			readonly registryId: RegistryId;
			readonly sealKeyServers: readonly KeyServerConfig[];
			readonly walrusEndpoints: WalrusEndpoints;
		}
	>
> = {
	mainnet: {
		// Published 2026-09-09, tx HmiywHYifmrNLMvY2oT8cP5W9hpQc2wFTJAaaQoM8mLY.
		// A fresh v1 publish with no upgrades, so published-at, original-id, and
		// the recipient_file type origin are all the same address. They are
		// spelled out separately rather than aliased because the FIRST upgrade
		// splits them: packageId moves, the other two stay here. See the testnet
		// entry below for what that divergence looks like in practice.
		packageId: toPackageId(
			"0x4fc7af5d1e19f96e5fab4e677948214eec35e238b252a106c7d5036dcebdcae2",
		),
		originalPackageId: toPackageId(
			"0x4fc7af5d1e19f96e5fab4e677948214eec35e238b252a106c7d5036dcebdcae2",
		),
		recipientFileEventOriginPackageId: toPackageId(
			"0x4fc7af5d1e19f96e5fab4e677948214eec35e238b252a106c7d5036dcebdcae2",
		),
		// Shared PublicationRegistry created by the publish tx's init.
		registryId: toRegistryId(
			"0x8d8b23c7acd7c1b260c793f2c648c5be8eb06db7c107b9f06ca3f39b700868ea",
		),
		// Deliberately empty: mainnet has no key servers this SDK can default to.
		// Every operator is commercial, including Mysten's committee aggregator,
		// which answers 401 "No API key found in request" on every endpoint.
		//
		// 0.5.0 shipped the committee here and it was actively harmful. Seal
		// reads key-server public keys from chain but fetches key SHARES from the
		// aggregator, so encryption succeeded and only decryption 401'd: a
		// consumer could encrypt, pay to store the ciphertext on Walrus, and then
		// find it permanently unreadable. Failing at construction instead is the
		// whole point. See `MAINNET_SEAL_COMMITTEE` to opt in with credentials.
		sealKeyServers: [],
		// Canonical Mysten-run Walrus mainnet aggregator. Publisher is left
		// undefined for the same reason as testnet: no single canonical operator.
		walrusEndpoints: {
			aggregator: "https://aggregator.walrus-mainnet.walrus.space",
		},
	},
	testnet: {
		// Updated 2026-06-04 for v4 upgrade (recipient_file::new_recipient_file_with_seal_prefix
		// + seal_approve_with_prefix added; legacy file/allowlist modules unused).
		// originalPackageId stays at v1 (publication-modules genesis); used
		// for type-filtered queries against publication / collection / entry.
		packageId: toPackageId(
			"0x468727724e86b7d305e961aee73ef9d868b4b68478952fc23748ef4ccfcaf4b2",
		),
		originalPackageId: toPackageId(
			"0x191946c5dc1ea1b978e664d85455e81ef9bdd1d3dbb221fd48cf9008d46a00f0",
		),
		// recipient_file::* event structs were defined in the v3 upgrade.
		// Tracked separately because it must NOT move on future upgrades
		// that don't redefine the recipient_file module.
		recipientFileEventOriginPackageId: toPackageId(
			"0x3bb8773c55b5bfde6c3821da52afd038a52e6a6ac586d5106013144f3aa7747f",
		),
		registryId: toRegistryId(
			"0xb25e4849d720ad5058c1945a819aa1dc01ff899006e3f0fe7cb9c62668d307e2",
		),
		// Canonical Seal testnet allowlist; mirrors the values used in Mysten's
		// own integration tests at
		// https://github.com/MystenLabs/ts-sdks/blob/main/packages/seal/test/unit/integration.test.ts
		// Pulled 2026-05-08. Public, stable; not a secret.
		sealKeyServers: [
			{
				objectId:
					"0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
				weight: 1,
			},
			{
				objectId:
					"0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8",
				weight: 1,
			},
		],
		// Canonical Mysten-run Walrus testnet aggregator. Used by
		// `HttpAggregatorReadAdapter.fromMorseConfig` for browser dapps that
		// need a single CORS-friendly endpoint instead of the direct-protocol
		// shard fanout (which has incomplete CORS coverage on testnet).
		// Publisher is intentionally undefined - there is no single canonical
		// testnet publisher; consumers wire their own (Nami, self-hosted, etc).
		walrusEndpoints: {
			aggregator: "https://aggregator.walrus-testnet.walrus.space",
		},
	},
};

/**
 * Options for `morseConfig`. `network` is required; address fields are
 * optional and override the canonical deployment when supplied. Use them
 * for forks or local deployments.
 */
export interface MorseConfigOptions {
	readonly network: Network;
	readonly rpcUrl?: string;
	readonly packageId?: PackageId;
	readonly originalPackageId?: PackageId;
	readonly recipientFileEventOriginPackageId?: PackageId;
	readonly registryId?: RegistryId;
	readonly sealKeyServers?: readonly KeyServerConfig[];
	readonly walrusEndpoints?: WalrusEndpoints;
}

/**
 * Build a `NetworkConfig` pointing at the canonical Morse deployment for the
 * chosen network, with optional per-field overrides for forks and local nodes.
 * @throws {ConfigurationError} If the chosen network has no canonical deployment
 *   and `packageId` and `registryId` are not supplied as overrides.
 */
export function morseConfig(options: MorseConfigOptions): NetworkConfig {
	const deployment = KNOWN_DEPLOYMENTS[options.network];
	const packageId = options.packageId ?? deployment?.packageId;
	const originalPackageId =
		options.originalPackageId ?? deployment?.originalPackageId;
	const recipientFileEventOriginPackageId =
		options.recipientFileEventOriginPackageId ??
		deployment?.recipientFileEventOriginPackageId;
	const registryId = options.registryId ?? deployment?.registryId;

	if (!packageId || !registryId) {
		throw new ConfigurationError(
			`No canonical Morse deployment for network "${options.network}". Supply packageId, originalPackageId, and registryId for a custom deployment.`,
		);
	}

	return {
		network: options.network,
		rpcUrl: options.rpcUrl ?? DEFAULT_RPC_URLS[options.network],
		packageId,
		registryId,
		...(originalPackageId === undefined ? {} : { originalPackageId }),
		...(recipientFileEventOriginPackageId === undefined
			? {}
			: { recipientFileEventOriginPackageId }),
		sealKeyServers: options.sealKeyServers ?? deployment?.sealKeyServers ?? [],
		walrusEndpoints: options.walrusEndpoints ??
			deployment?.walrusEndpoints ?? { aggregator: "" },
	};
}
