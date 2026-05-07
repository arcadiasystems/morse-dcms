/**
 * Network configuration types and defaults.
 */

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
