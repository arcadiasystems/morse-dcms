#!/usr/bin/env bun
/**
 * Example: two-party encrypted file sharing via RecipientFile.
 *
 * Alice uploads a Seal-encrypted file with Bob as a recipient. Bob fetches
 * the file metadata, downloads the ciphertext from Walrus, and decrypts
 * using his SessionKey.
 *
 * Costs real testnet SUI and WAL. Both keypairs must hold gas + WAL.
 *
 * Required env vars:
 *   ALICE_PRIVATE_KEY   - Alice's suiprivkey1... (uploader)
 *   BOB_PRIVATE_KEY     - Bob's suiprivkey1...   (recipient)
 * Optional:
 *   SUI_RPC_URL         - override the default testnet RPC URL
 */

import { SessionKey } from "@mysten/seal";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import {
	buildRecipientFileSealId,
	DefaultSealAdapter,
	DefaultWalrusReadAdapter,
	DefaultWalrusWriteAdapter,
	deleteRecipientFile,
	KeypairAdapter,
	morseConfig,
	RpcRecipientFilesReader,
	type SuiAddress,
	toSuiAddress,
	uploadEncryptedRecipientFileFromBytes,
} from "../src/index.js";
import { done, formatMist, readEnv, step } from "./_shared.js";

function loadKeypair(envName: string): Ed25519Keypair {
	const privateKey = readEnv(envName);
	const { scheme, secretKey } = decodeSuiPrivateKey(privateKey);
	if (scheme !== "ED25519") {
		throw new Error(`${envName} must be Ed25519; got ${scheme}`);
	}
	return Ed25519Keypair.fromSecretKey(secretKey);
}

async function main(): Promise<void> {
	const config = morseConfig({
		network: "testnet",
		...(process.env.SUI_RPC_URL ? { rpcUrl: process.env.SUI_RPC_URL } : {}),
	});
	const client = new SuiGrpcClient({
		network: "testnet",
		baseUrl: config.rpcUrl,
	});

	const aliceKp = loadKeypair("ALICE_PRIVATE_KEY");
	const bobKp = loadKeypair("BOB_PRIVATE_KEY");
	const alice = new KeypairAdapter(aliceKp, client);
	const bob = new KeypairAdapter(bobKp, client);
	const bobAddress: SuiAddress = toSuiAddress(bob.address);

	step(1, 6, `Alice=${alice.address}`);
	done(`Bob=${bob.address}`);

	step(2, 6, "Building Alice's Walrus and Seal adapters...");
	const aliceWalrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: client },
		aliceKp,
	);
	const aliceSeal = DefaultSealAdapter.fromMorseConfig(config, {}, client);
	done("ready");

	step(
		3,
		6,
		"Alice uploads encrypted RecipientFile addressed to Bob (2 popups)...",
	);
	const plaintext = new TextEncoder().encode(
		`alice-to-bob-message-${Date.now()}`,
	);
	const uploaded = await uploadEncryptedRecipientFileFromBytes(alice, config, {
		walrus: aliceWalrus,
		seal: aliceSeal,
		plaintext,
		recipients: [bobAddress],
		name: "alice-message.txt",
		contentType: "text/plain",
		upload: { epochs: 3, deletable: true },
		onProgress: (e) => done(`progress: ${e.phase}`),
	});
	done(
		`fileId=${uploaded.fileId} blobId=${uploaded.blobId} gas=${formatMist(uploaded.gasUsedMist)}`,
	);

	step(4, 6, "Bob fetches the file metadata...");
	const bobWalrusRead = DefaultWalrusReadAdapter.fromConfig({
		network: "testnet",
		suiClient: client,
	});
	const filesReader = RpcRecipientFilesReader.fromConfig(client, {
		packageId: config.packageId,
	});
	const file = await filesReader.getRecipientFile(uploaded.fileId);
	if (!file.members.includes(bobAddress)) {
		throw new Error(`Bob is not in members: ${JSON.stringify(file.members)}`);
	}
	done(
		`owner=${file.owner} name=${file.name} members=${file.members.length} (Bob included)`,
	);

	step(5, 6, "Bob decrypts...");
	const bobSeal = DefaultSealAdapter.fromMorseConfig(config, {}, client);
	const bobSessionKey = await SessionKey.create({
		address: bob.address,
		packageId: config.originalPackageId ?? config.packageId,
		ttlMin: 10,
		suiClient: client,
	});
	const personalMessage = bobSessionKey.getPersonalMessage();
	const { signature } = await bobKp.signPersonalMessage(personalMessage);
	bobSessionKey.setPersonalMessageSignature(signature);

	const ciphertext = await bobWalrusRead.readBlob(uploaded.blobId);
	const sealId = buildRecipientFileSealId(
		uploaded.sealIdPrefix,
		uploaded.sealNonce,
	);
	const decrypted = await bobSeal.decryptUnderRecipientFile(ciphertext, {
		sessionKey: bobSessionKey,
		sealId,
		fileId: uploaded.fileId,
	});
	const decryptedText = new TextDecoder().decode(decrypted);
	const expected = new TextDecoder().decode(plaintext);
	if (decryptedText !== expected) {
		throw new Error(
			`decrypt mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(decryptedText)}`,
		);
	}
	done(
		`Bob decrypted ${decrypted.length} bytes: ${JSON.stringify(decryptedText)}`,
	);

	step(6, 6, "Alice cleans up the file...");
	const deleted = await deleteRecipientFile(alice, config, {
		fileId: uploaded.fileId,
	});
	done(`gas=${formatMist(deleted.gasUsedMist)}`);

	console.log("\n[ok] alice-bob recipient-file example");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
