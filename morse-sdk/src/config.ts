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
 * Points the SDK at a Morse deployment. Obtain `packageId` and `registryId`
 * from the `sui client publish` output for your target network.
 */
export interface NetworkConfig {
	readonly network: Network;
	readonly rpcUrl: string;
	readonly packageId: PackageId;
	readonly registryId: RegistryId;
}
