/**
 * Shared illustrative setup used by every example in this directory. The
 * examples are compile-checked but not meant to be executed as a unit; each
 * exported function shows the shape of one flow.
 *
 * Choosing a network: `buildContext` reads `MORSE_NETWORK`, the variable
 * morse-cli and the smoke scripts in `scripts/` also read. Leave it unset for
 * testnet. For mainnet, set both variables:
 *
 *   MORSE_NETWORK=mainnet MORSE_ALLOW_MAINNET=1
 *
 * Mainnet writes spend real SUI and WAL, so mainnet has to be chosen twice,
 * as in the smoke scripts: a `MORSE_NETWORK=mainnet` left exported from a
 * morse-cli session is not enough on its own. Any other value throws. The
 * Seal examples in `encrypted-entries.ts` stay on testnet and throw on a
 * mainnet context.
 *
 * For real runs, see `scripts/` (which has its own setup harness + cleanup
 * ordering).
 */

import {
	ConfigurationError,
	KeypairAdapter,
	morseConfig,
	type NetworkConfig,
	RpcPublicationReader,
} from "@arcadiasystems/morse-sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

/** Networks the examples can target. Walrus has no localnet deployment. */
export type ExampleNetwork = "mainnet" | "testnet";

/**
 * `keypair` is present so examples can pass a raw signer to `Walrus`/`Seal`
 * adapters that don't take a `WalletAdapter`. Browser flows substitute a
 * wallet-standard signer instead and omit this field.
 *
 * `network` is what the Sui client and `config` were built for. Pass it to
 * Walrus adapters too, so Sui and Walrus always target the same network.
 */
export interface ExampleContext {
	readonly network: ExampleNetwork;
	readonly client: SuiGrpcClient;
	readonly keypair: Ed25519Keypair;
	readonly adapter: KeypairAdapter;
	readonly reader: RpcPublicationReader;
	readonly config: NetworkConfig;
}

/**
 * Resolve the network from `MORSE_NETWORK`, defaulting to testnet.
 * @throws {ConfigurationError} If the value is neither `testnet` nor
 *   `mainnet`, or is `mainnet` without `MORSE_ALLOW_MAINNET=1`.
 */
function networkFromEnv(): ExampleNetwork {
	const requested = process.env.MORSE_NETWORK ?? "testnet";
	if (requested === "testnet") {
		return "testnet";
	}
	if (requested === "mainnet") {
		if (process.env.MORSE_ALLOW_MAINNET !== "1") {
			throw new ConfigurationError(
				"MORSE_NETWORK=mainnet also requires MORSE_ALLOW_MAINNET=1, because mainnet writes spend real SUI and WAL.",
			);
		}
		return "mainnet";
	}
	throw new ConfigurationError(
		`Unknown MORSE_NETWORK "${requested}". Use testnet or mainnet (Walrus has no localnet).`,
	);
}

/**
 * Build a context: morseConfig for the network `MORSE_NETWORK` selects
 * (testnet by default), gRPC client, wallet adapter wrapping a raw keypair,
 * reader threaded with the canonical originalPackageId.
 *
 * Production browser flows substitute a wallet-standard signer for the raw
 * keypair; see the file-level docstring in `examples/publisher-caps.ts` for
 * how the `WalletAdapter` interface fits into that flow.
 *
 * @throws {ConfigurationError} If `MORSE_NETWORK` is unsupported, or selects
 *   mainnet without `MORSE_ALLOW_MAINNET=1`.
 */
export function buildContext(privateKey: string): ExampleContext {
	const network = networkFromEnv();
	const config = morseConfig({ network });
	const client = new SuiGrpcClient({ network, baseUrl: config.rpcUrl });
	const keypair = Ed25519Keypair.fromSecretKey(privateKey);
	const adapter = new KeypairAdapter(keypair, client);
	const reader = RpcPublicationReader.fromMorseConfig(config, client);
	return { network, client, keypair, adapter, reader, config };
}
