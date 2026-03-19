import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { walrus } from "@mysten/walrus";

export type SuiWalrusClient = ReturnType<typeof createSuiClient>;

export function createSuiClient(url: string) {
	return new SuiGrpcClient({ network: "testnet", baseUrl: url }).$extend(
		walrus(),
	);
}

export interface AppContext {
	suiClient: SuiWalrusClient;
	keypair: Ed25519Keypair;
	publicationAddress: string;
	originalPublicationAddress: string;
}
