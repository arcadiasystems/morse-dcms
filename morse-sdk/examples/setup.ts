/**
 * Shared illustrative setup used by every example in this directory. The
 * examples are compile-checked but not meant to be executed as a unit; each
 * exported function shows the shape of one flow.
 *
 * For real testnet runs, see `scripts/` (which has its own setup harness +
 * cleanup ordering).
 */

import {
	KeypairAdapter,
	morseConfig,
	type NetworkConfig,
	RpcPublicationReader,
} from "@arcadiasystems/morse-sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

/**
 * `keypair` is present so examples can pass a raw signer to `Walrus`/`Seal`
 * adapters that don't take a `WalletAdapter`. Browser flows substitute a
 * wallet-standard signer instead and omit this field.
 */
export interface ExampleContext {
	readonly client: SuiGrpcClient;
	readonly keypair: Ed25519Keypair;
	readonly adapter: KeypairAdapter;
	readonly reader: RpcPublicationReader;
	readonly config: NetworkConfig;
}

/**
 * Build a context: morseConfig pinned to testnet, gRPC client, wallet adapter
 * wrapping a raw keypair, reader threaded with the canonical originalPackageId.
 *
 * Production browser flows substitute a wallet-standard signer for the raw
 * keypair; see the file-level docstring in `examples/publisher-caps.ts` for
 * how the `WalletAdapter` interface fits into that flow.
 */
export function buildContext(privateKey: string): ExampleContext {
	const config = morseConfig({ network: "testnet" });
	const client = new SuiGrpcClient({
		network: "testnet",
		baseUrl: config.rpcUrl,
	});
	const keypair = Ed25519Keypair.fromSecretKey(privateKey);
	const adapter = new KeypairAdapter(keypair, client);
	const reader = RpcPublicationReader.fromMorseConfig(config, client);
	return { client, keypair, adapter, reader, config };
}
