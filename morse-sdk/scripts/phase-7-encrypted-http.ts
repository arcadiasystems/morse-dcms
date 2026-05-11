#!/usr/bin/env bun

/**
 * Phase 7 encrypted smoke using the HTTP adapters: encrypts plaintext,
 * uploads ciphertext via the publisher, adds the encrypted entry, reads
 * the ciphertext back via the aggregator, decrypts via a SessionKey.
 *
 * Skips cleanly when endpoint env vars are unset.
 *
 * Required env vars:
 *   PRIVATE_KEY            - suiprivkey1... bech32 secret key
 *   WALRUS_PUBLISHER_URL   - e.g. https://walrus-testnet-publisher.nami.cloud
 * Optional:
 *   WALRUS_AGGREGATOR_URL  - defaults to morseConfig's canonical aggregator
 *   SUI_RPC_URL            - override the default testnet RPC URL
 *
 * Run from `morse-sdk/`:
 *   WALRUS_PUBLISHER_URL=... bun run scripts/phase-7-encrypted-http.ts
 */

import { SessionKey } from "@mysten/seal";

import {
	addEncryptedEntry,
	buildPublisherSealId,
	createCollection,
	createPublication,
	DefaultSealAdapter,
	HttpAggregatorReadAdapter,
	HttpPublisherWriteAdapter,
	StorageMode,
} from "../src/index.js";
import {
	buildSmokeContext,
	cleanupSmokePublication,
	done,
	step,
} from "./_shared.js";

async function main(): Promise<void> {
	const publisherUrl = process.env.WALRUS_PUBLISHER_URL;
	const aggregatorOverride = process.env.WALRUS_AGGREGATOR_URL;

	if (!publisherUrl) {
		console.log(
			"PHASE 7 ENCRYPTED HTTP SMOKE: SKIPPED (set WALRUS_PUBLISHER_URL to run)",
		);
		return;
	}

	const ctx = buildSmokeContext();
	const slug = `morse-http-encrypted-${Date.now()}`;

	step(1, 9, `Connected; address ${ctx.adapter.address}`);
	done(`rpc=${ctx.config.rpcUrl}`);

	step(2, 9, "Building HTTP Walrus adapters + default Seal adapter...");
	const walrus = HttpPublisherWriteAdapter.fromConfig({
		publisherUrl,
		ownerAddress: ctx.adapter.address,
	});
	const reader = HttpAggregatorReadAdapter.fromMorseConfig(
		aggregatorOverride === undefined
			? ctx.config
			: { walrusEndpoints: { aggregator: aggregatorOverride } },
		ctx.client,
	);
	const seal = DefaultSealAdapter.fromMorseConfig(ctx.config, {}, ctx.client);
	done(`publisher=${publisherUrl}`);

	step(3, 9, `Creating publication "${slug}"...`);
	const created = await createPublication(ctx.adapter, ctx.config, {
		name: "Phase 7 Encrypted HTTP Smoke",
		slug,
	});
	done(`publicationId=${created.publicationId}`);

	const collectionName = "secret-blog";
	const entryIds: number[] = [];

	let success = false;
	try {
		step(4, 9, `Creating blob-mode collection "${collectionName}"...`);
		await createCollection(ctx.adapter, ctx.config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			name: collectionName,
			storageMode: StorageMode.Blob,
		});
		done("collection created");

		const plaintext = new TextEncoder().encode(
			`hello-via-publisher-${Date.now()}`,
		);
		const nonce = crypto.getRandomValues(new Uint8Array(16));
		const sealId = buildPublisherSealId(created.publicationId, nonce);

		step(5, 9, "Encrypting plaintext via Seal...");
		const { ciphertext } = await seal.encrypt(plaintext, { sealId });
		done(`ciphertext=${ciphertext.length} bytes`);

		step(6, 9, "Uploading ciphertext via publisher HTTP...");
		const blob = await walrus.uploadBlob(ciphertext, {
			epochs: 3,
			deletable: true,
		});
		done(`blobObjectId=${blob.blobObjectId}`);

		step(7, 9, "Adding encrypted entry (1 popup)...");
		const added = await addEncryptedEntry(ctx.adapter, ctx.config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			collectionName,
			name: "secret",
			blobObjectId: blob.blobObjectId,
			contentType: "application/octet-stream",
			sealId,
		});
		entryIds.push(added.entryId);
		done(`entryId=${added.entryId}`);

		step(8, 9, "Reading ciphertext back via aggregator HTTP...");
		const recovered = await reader.readBlobByObjectId(blob.blobObjectId);
		if (recovered.length !== ciphertext.length) {
			throw new Error(
				`aggregator returned ${recovered.length} bytes; expected ${ciphertext.length}`,
			);
		}
		for (let i = 0; i < ciphertext.length; i += 1) {
			if (recovered[i] !== ciphertext[i]) {
				throw new Error(
					`aggregator returned wrong bytes at offset ${i}: expected 0x${ciphertext[i]?.toString(16)}, got 0x${recovered[i]?.toString(16)}`,
				);
			}
		}
		done(`${recovered.length} bytes match ciphertext (byte-wise)`);

		step(9, 9, "Decrypting via SessionKey...");
		const sessionKey = await SessionKey.create({
			address: ctx.adapter.address,
			packageId: ctx.config.originalPackageId ?? ctx.config.packageId,
			ttlMin: 10,
			signer: ctx.keypair,
			suiClient: ctx.client,
		});
		const decrypted = await seal.decrypt(recovered, {
			sessionKey,
			sealId,
			publisherCapId: created.publisherCapId,
		});
		if (
			new TextDecoder().decode(decrypted) !==
			new TextDecoder().decode(plaintext)
		) {
			throw new Error("decrypted plaintext does not match original");
		}
		done(`decrypted ${decrypted.length} bytes; matches original`);

		success = true;
	} finally {
		await cleanupSmokePublication(ctx, {
			created,
			collectionNames: [collectionName],
			entryIdsByCollection: new Map([[collectionName, entryIds]]),
		});
	}

	if (success) {
		console.log("\nPHASE 7 ENCRYPTED HTTP SMOKE: PASS");
	}
}

main().catch((error: unknown) => {
	console.error("\nPHASE 7 ENCRYPTED HTTP SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
