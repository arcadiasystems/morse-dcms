#!/usr/bin/env bun
/**
 * Example: Alice shares an encrypted file with Bob.
 *
 * Narrative walkthrough of the file-sharing flow against testnet, written for
 * readers learning the API rather than as a smoke test (which is what
 * `phase-9-encrypted-file.ts` is). Two real keypairs are used so the access
 * check is meaningful — Bob is genuinely a different address.
 *
 * Required env vars:
 *   ALICE_PRIVATE_KEY  - suiprivkey1... for the file owner
 *   BOB_PRIVATE_KEY    - suiprivkey1... for the recipient
 *
 * Both addresses must hold testnet SUI; Alice additionally needs WAL for
 * the Walrus upload. Get testnet SUI from https://faucet.sui.io and WAL
 * from https://docs.walrus.site/usage/web-tool.html#testnet-tokens.
 */

import { SessionKey } from "@mysten/seal";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import {
	addMember,
	buildAllowlistSealId,
	createAllowlist,
	DefaultSealAdapter,
	DefaultWalrusReadAdapter,
	DefaultWalrusWriteAdapter,
	deleteAllowlist,
	deleteFile,
	KeypairAdapter,
	morseConfig,
	RpcFilesReader,
	toSuiAddress,
	uploadEncryptedFileFromBytes,
} from "../src/index.js";

function readKey(name: string): Ed25519Keypair {
	const raw = process.env[name];
	if (!raw) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
	const { scheme, secretKey } = decodeSuiPrivateKey(raw);
	if (scheme !== "ED25519") {
		throw new Error(`${name} must be an Ed25519 key; got ${scheme}`);
	}
	return Ed25519Keypair.fromSecretKey(secretKey);
}

function header(title: string): void {
	console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
	const alice = readKey("ALICE_PRIVATE_KEY");
	const bob = readKey("BOB_PRIVATE_KEY");
	const aliceAddress = toSuiAddress(alice.getPublicKey().toSuiAddress());
	const bobAddress = toSuiAddress(bob.getPublicKey().toSuiAddress());

	const config = morseConfig({ network: "testnet" });
	const client = new SuiGrpcClient({
		network: "testnet",
		baseUrl: config.rpcUrl,
	});
	const aliceWallet = new KeypairAdapter(alice, client);
	const filesReader = RpcFilesReader.fromMorseConfig(config, client);
	const walrusWrite = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: client },
		alice,
	);
	const walrusRead = DefaultWalrusReadAdapter.fromConfig({
		network: "testnet",
		suiClient: client,
	});
	const seal = DefaultSealAdapter.fromMorseConfig(config, {}, client);

	console.log("Alice:", aliceAddress);
	console.log("Bob:  ", bobAddress);

	// Step 1: Alice creates an allowlist for her private documents.
	header("Step 1: Alice creates an allowlist");
	const allowlist = await createAllowlist(aliceWallet, config, {
		name: "private-docs",
	});
	console.log("Allowlist:", allowlist.allowlistId);
	console.log("Cap:      ", allowlist.capId);
	const { allowlistId, capId } = allowlist;

	try {
		// Step 2: Alice adds Bob to the allowlist.
		header("Step 2: Alice adds Bob to the allowlist");
		await addMember(aliceWallet, config, {
			allowlistId,
			capId,
			member: bobAddress,
		});
		console.log(`Bob is now a member of ${allowlistId}`);

		// Step 3: Alice encrypts + uploads a file gated by that allowlist.
		header("Step 3: Alice encrypts + uploads a file");
		const plaintext = new TextEncoder().encode(
			"My tax return for 2025-2026.\nAGI: $42,000\nRefund: $1,337",
		);
		const nonce = crypto.getRandomValues(new Uint8Array(16));
		const sealId = buildAllowlistSealId(allowlistId, nonce);
		const upload = await uploadEncryptedFileFromBytes(aliceWallet, config, {
			walrus: walrusWrite,
			seal,
			allowlistId,
			sealId,
			plaintext,
			name: "tax-return-2025.txt",
			contentType: "text/plain",
			upload: { epochs: 2, deletable: true },
			onProgress: (e) => console.log(`  progress: ${e.phase}`),
		});
		console.log("File:", upload.fileId);
		console.log("Blob:", upload.blobId);
		// IMPORTANT: Alice gives Bob the sealId out-of-band (e.g. in the share
		// link metadata, or via an indexer that exposes it). The encrypted
		// bytes on Walrus don't carry the identity in a consumer-readable
		// form — knowing the sealId is what lets Bob's client request the
		// right decryption shares.

		// Step 4: Bob reads the file metadata from chain.
		header("Step 4: Bob reads the file metadata");
		const file = await filesReader.getEncryptedFile(upload.fileId);
		console.log(`name=${file.name}, contentType=${file.contentType}`);
		console.log(`encrypted=${file.encrypted}, allowlist=${file.allowlistId}`);
		console.log(`size=${file.size} bytes`);

		// Step 5: Bob downloads the ciphertext from Walrus.
		header("Step 5: Bob downloads ciphertext from Walrus");
		const ciphertext = await walrusRead.readBlob(file.blobId);
		console.log(`Ciphertext: ${ciphertext.length} bytes`);

		// Step 6: Bob creates a session key and decrypts.
		// In a browser dapp, this is the only wallet popup Bob sees during
		// this whole flow — Seal asks his wallet to sign a domain-separated
		// personal message proving consent.
		header("Step 6: Bob decrypts using a SessionKey");
		const bobSessionKey = await SessionKey.create({
			address: bobAddress,
			packageId: config.originalPackageId ?? config.packageId,
			ttlMin: 10,
			signer: bob,
			suiClient: client,
		});
		const decrypted = await seal.decryptUnderAllowlist(ciphertext, {
			sealId,
			allowlistId,
			sessionKey: bobSessionKey,
		});
		console.log("Decrypted plaintext:");
		console.log(new TextDecoder().decode(decrypted));

		// Cleanup
		header("Cleanup");
		await deleteFile(aliceWallet, config, { fileId: upload.fileId });
		console.log("File deleted.");
	} finally {
		try {
			await deleteAllowlist(aliceWallet, config, { allowlistId, capId });
			console.log("Allowlist deleted.");
		} catch (error) {
			console.error("Failed to delete allowlist:", error);
		}
	}
}

main().catch((error) => {
	console.error("\nExample FAILED:", error);
	process.exit(1);
});
