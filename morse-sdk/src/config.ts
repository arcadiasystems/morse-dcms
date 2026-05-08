/**
 * Network configuration types, defaults, and the `morseConfig` factory that
 * hides deployed package addresses from consumers using known networks.
 */

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
export interface NetworkConfig {
	readonly network: Network;
	readonly rpcUrl: string;
	readonly packageId: PackageId;
	readonly originalPackageId?: PackageId;
	readonly registryId: RegistryId;
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

// morseConfig factory

/**
 * Canonical Morse deployment addresses per network. Updated on every contract
 * redeploy during active development; expected to stabilize after Phase 7
 * when the contracts are frozen for v0.1.0.
 */
const KNOWN_DEPLOYMENTS: Partial<
	Record<
		Network,
		{
			readonly packageId: PackageId;
			readonly originalPackageId: PackageId;
			readonly registryId: RegistryId;
		}
	>
> = {
	testnet: {
		packageId: toPackageId(
			"0x191946c5dc1ea1b978e664d85455e81ef9bdd1d3dbb221fd48cf9008d46a00f0",
		),
		originalPackageId: toPackageId(
			"0x191946c5dc1ea1b978e664d85455e81ef9bdd1d3dbb221fd48cf9008d46a00f0",
		),
		registryId: toRegistryId(
			"0xb25e4849d720ad5058c1945a819aa1dc01ff899006e3f0fe7cb9c62668d307e2",
		),
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
	readonly registryId?: RegistryId;
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
	const registryId = options.registryId ?? deployment?.registryId;

	if (!packageId || !registryId) {
		if (options.network === "mainnet") {
			throw new ConfigurationError(
				"Morse is not yet deployed on mainnet. Use { network: 'testnet' } or supply packageId, originalPackageId, and registryId for a custom deployment.",
			);
		}
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
	};
}
