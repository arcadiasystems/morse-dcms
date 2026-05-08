#!/usr/bin/env bun
/**
 * Phase 5 smoke: upload a blob and a quilt to Walrus testnet, decode the
 * patch IDs, and confirm the round-trips. Costs real testnet WAL and SUI;
 * this script lives outside `examples/` so it is never run by sweeps that
 * iterate the examples directory.
 *
 * Failures of the form `NotEnoughBlobConfirmationsError: Too many failures
 * while writing blob ... to nodes` are testnet committee flakes (a quorum of
 * storage nodes did not confirm in time); rerun.
 *
 * Required env vars:
 *   PRIVATE_KEY  - suiprivkey1... bech32 secret key (must hold testnet SUI and WAL)
 *
 * Optional:
 *   SUI_RPC_URL  - override the default testnet RPC URL
 *
 * Run from `morse-sdk/`:
 *   bun run scripts/phase-5-walrus.ts
 */

import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
	DefaultWalrusWriteAdapter,
	decodeQuiltPatchId,
	morseConfig,
	QUILT_PATCH_ID_LENGTH,
	quiltPatchIdToString,
} from "../src/index.js";
import { done, readEnv, step } from "./_shared.js";

async function main(): Promise<void> {
	const privateKey = readEnv("PRIVATE_KEY");
	const config = morseConfig({
		network: "testnet",
		...(process.env.SUI_RPC_URL ? { rpcUrl: process.env.SUI_RPC_URL } : {}),
	});

	step(1, 5, `Connecting Sui client to ${config.rpcUrl}...`);
	const suiClient = new SuiGrpcClient({
		network: "testnet",
		baseUrl: config.rpcUrl,
	});
	done("connected");

	step(2, 5, "Loading keypair from PRIVATE_KEY...");
	const { scheme, secretKey } = decodeSuiPrivateKey(privateKey);
	if (scheme !== "ED25519") {
		throw new Error(`Phase 5 smoke expects an Ed25519 key; got ${scheme}`);
	}
	const keypair = Ed25519Keypair.fromSecretKey(secretKey);
	done(`address ${keypair.toSuiAddress()}`);

	step(3, 5, "Building Walrus write adapter (testnet)...");
	const adapter = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient },
		keypair,
	);
	done("adapter ready");

	const nonce = Date.now().toString();

	step(4, 5, "Uploading a single blob...");
	const payload = new TextEncoder().encode(`hello-morse-blob-${nonce}`);
	const blob = await adapter.uploadBlob(payload, {
		epochs: 3,
		deletable: true,
	});
	done(`blobId=${blob.blobId} blobObjectId=${blob.blobObjectId}`);

	step(5, 5, "Uploading a 2-patch quilt and decoding patch IDs...");
	const quilt = await adapter.uploadQuilt(
		[
			{
				contents: new TextEncoder().encode(`hello-morse-patch-1-${nonce}`),
				identifier: `first-${nonce}`,
			},
			{
				contents: new TextEncoder().encode(`hello-morse-patch-2-${nonce}`),
				identifier: `second-${nonce}`,
			},
		],
		{ epochs: 3, deletable: true },
	);
	for (const patch of quilt.patches) {
		if (patch.patchId.length !== QUILT_PATCH_ID_LENGTH) {
			throw new Error(
				`Patch ${patch.identifier} has wrong length: ${patch.patchId.length}`,
			);
		}
		const decoded = decodeQuiltPatchId(patch.patchId);
		if (decoded.startIndex !== patch.startIndex) {
			throw new Error(
				`Patch ${patch.identifier} startIndex mismatch: ${decoded.startIndex} vs ${patch.startIndex}`,
			);
		}
		if (decoded.endIndex !== patch.endIndex) {
			throw new Error(
				`Patch ${patch.identifier} endIndex mismatch: ${decoded.endIndex} vs ${patch.endIndex}`,
			);
		}
		console.log(
			`        ${patch.identifier}: patchId(b64)=${quiltPatchIdToString(patch.patchId)} start=${patch.startIndex} end=${patch.endIndex}`,
		);
	}

	console.log("\nPHASE 5 SMOKE: PASS");
}

main().catch((error: unknown) => {
	console.error("\nPHASE 5 SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
