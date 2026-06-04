#!/usr/bin/env bun
/**
 * Phase 8 smoke: end-to-end RecipientFile flow on testnet.
 *
 *   1. Upload a public file via `uploadRecipientFileFromBytes` (2 popups).
 *   2. Read it back via `RpcRecipientFilesReader.getRecipientFile`.
 *   3. Upload an encrypted file via `uploadEncryptedRecipientFileFromBytes`
 *      (2 popups; encryption is popup-free).
 *   4. Verify the encrypted file is decryptable by the owner (auto-recipient)
 *      via `seal.decryptUnderRecipientFile`.
 *   5. Delete both files.
 *
 * Costs real testnet WAL and SUI. `NotEnoughBlobConfirmationsError` is a
 * Walrus testnet committee flake; retry.
 *
 * Required env vars:
 *   PRIVATE_KEY        - suiprivkey1... bech32 secret key
 * Optional:
 *   SUI_RPC_URL        - override the default testnet RPC URL
 *   SEAL_KEY_SERVERS   - JSON array of {"objectId": "0x...", "weight": 1}
 *   SEAL_THRESHOLD     - integer threshold; overrides default
 */

import { SessionKey } from "@mysten/seal";
import {
	buildRecipientFileSealId,
	DefaultSealAdapter,
	DefaultWalrusReadAdapter,
	DefaultWalrusWriteAdapter,
	deleteRecipientFile,
	RpcRecipientFilesReader,
	uploadEncryptedRecipientFileFromBytes,
	uploadRecipientFileFromBytes,
} from "../src/index.js";
import { buildSmokeContext, done, formatMist, step } from "./_shared.js";

async function main(): Promise<void> {
	const ctx = buildSmokeContext();

	step(1, 8, `Connected; address ${ctx.adapter.address}`);
	done(`rpc=${ctx.config.rpcUrl}`);

	step(2, 8, "Building Walrus and Seal adapters (testnet)...");
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);
	const walrusRead = DefaultWalrusReadAdapter.fromConfig({
		network: "testnet",
		suiClient: ctx.client,
	});
	const seal = DefaultSealAdapter.fromMorseConfig(ctx.config, {}, ctx.client);
	const filesReader = RpcRecipientFilesReader.fromConfig(ctx.client, {
		packageId: ctx.config.packageId,
	});
	done("adapters ready");

	step(3, 8, "Uploading public RecipientFile (2 popups)...");
	const publicBytes = new TextEncoder().encode(
		`hello-recipient-file-public-${Date.now()}`,
	);
	const publicResult = await uploadRecipientFileFromBytes(
		ctx.adapter,
		ctx.config,
		{
			walrus,
			bytes: publicBytes,
			recipients: [],
			name: "hello.txt",
			contentType: "text/plain",
			upload: { epochs: 3, deletable: true },
			onProgress: (e) => done(`progress: ${e.phase}`),
		},
	);
	done(
		`fileId=${publicResult.fileId} blobId=${publicResult.blobId} gas=${formatMist(publicResult.gasUsedMist)}`,
	);

	step(4, 8, "Reading public RecipientFile back...");
	const publicRead = await filesReader.getRecipientFile(publicResult.fileId);
	done(
		`owner=${publicRead.owner} name=${publicRead.name} members=${publicRead.members.length}`,
	);
	if (publicRead.owner !== ctx.adapter.address) {
		throw new Error(
			`owner mismatch: expected ${ctx.adapter.address}, got ${publicRead.owner}`,
		);
	}

	step(5, 8, "Uploading encrypted RecipientFile (2 popups)...");
	const plaintext = new TextEncoder().encode(
		`hello-recipient-file-encrypted-${Date.now()}`,
	);
	const encrypted = await uploadEncryptedRecipientFileFromBytes(
		ctx.adapter,
		ctx.config,
		{
			walrus,
			seal,
			plaintext,
			recipients: [],
			name: "secret.txt",
			contentType: "text/plain",
			upload: { epochs: 3, deletable: true },
			onProgress: (e) => done(`progress: ${e.phase}`),
		},
	);
	done(
		`fileId=${encrypted.fileId} blobId=${encrypted.blobId} gas=${formatMist(encrypted.gasUsedMist)}`,
	);

	step(6, 8, "Decrypting as owner via SessionKey...");
	const sessionKey = await SessionKey.create({
		address: ctx.adapter.address,
		packageId: ctx.config.originalPackageId ?? ctx.config.packageId,
		ttlMin: 10,
		suiClient: ctx.client,
	});
	const personalMessage = sessionKey.getPersonalMessage();
	const { signature } = await ctx.keypair.signPersonalMessage(personalMessage);
	sessionKey.setPersonalMessageSignature(signature);

	const ciphertext = await walrusRead.readBlob(encrypted.blobId);
	const sealId = buildRecipientFileSealId(
		encrypted.sealIdPrefix,
		encrypted.sealNonce,
	);
	const decrypted = await seal.decryptUnderRecipientFile(ciphertext, {
		sessionKey,
		sealId,
		fileId: encrypted.fileId,
	});
	const decryptedText = new TextDecoder().decode(decrypted);
	const expected = new TextDecoder().decode(plaintext);
	if (decryptedText !== expected) {
		throw new Error(
			`decrypt mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(decryptedText)}`,
		);
	}
	done(`decrypted ${decrypted.length} bytes (matches plaintext)`);

	step(7, 8, "Deleting public RecipientFile...");
	const publicDelete = await deleteRecipientFile(ctx.adapter, ctx.config, {
		fileId: publicResult.fileId,
	});
	done(`gas=${formatMist(publicDelete.gasUsedMist)}`);

	step(8, 8, "Deleting encrypted RecipientFile...");
	const encryptedDelete = await deleteRecipientFile(ctx.adapter, ctx.config, {
		fileId: encrypted.fileId,
	});
	done(`gas=${formatMist(encryptedDelete.gasUsedMist)}`);

	console.log("\n[ok] phase-8 recipient-file smoke");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
