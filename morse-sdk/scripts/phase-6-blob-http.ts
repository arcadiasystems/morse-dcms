#!/usr/bin/env bun

/**
 * Phase 6 blob-mode smoke using the HTTP adapters: uploads via the
 * Walrus publisher, reads back via the aggregator. Exercises the
 * operator-trusted browser-friendly path.
 *
 * Skips cleanly when endpoint env vars are unset — these aren't core
 * smokes (the default direct-protocol adapters cover the SDK's
 * fundamental contracts via phase-6-blob.ts); this script verifies the
 * HTTP variants against live operator services.
 *
 * Required env vars:
 *   PRIVATE_KEY            - suiprivkey1... bech32 secret key
 *   WALRUS_PUBLISHER_URL   - e.g. https://walrus-testnet-publisher.nami.cloud
 *   WALRUS_AGGREGATOR_URL  - optional; defaults to morseConfig's canonical aggregator
 * Optional:
 *   SUI_RPC_URL            - override the default testnet RPC URL
 *
 * Run from `morse-sdk/`:
 *   WALRUS_PUBLISHER_URL=... bun run scripts/phase-6-blob-http.ts
 */

import {
	addEntry,
	createCollection,
	createPublication,
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
			"PHASE 6 BLOB HTTP SMOKE: SKIPPED (set WALRUS_PUBLISHER_URL to run)",
		);
		return;
	}

	const ctx = buildSmokeContext();
	const slug = `morse-http-blob-${Date.now()}`;

	step(1, 7, `Connected; address ${ctx.adapter.address}`);
	done(`rpc=${ctx.config.rpcUrl}`);

	step(2, 7, "Building Walrus HTTP adapters (publisher + aggregator)...");
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
	done(`publisher=${publisherUrl}`);

	step(3, 7, `Creating publication "${slug}"...`);
	const created = await createPublication(ctx.adapter, ctx.config, {
		name: "Phase 6 Blob HTTP Smoke",
		slug,
	});
	done(`publicationId=${created.publicationId}`);

	const collectionName = "blog";
	const entryIds: number[] = [];

	let success = false;
	try {
		step(4, 7, `Creating blob-mode collection "${collectionName}"...`);
		await createCollection(ctx.adapter, ctx.config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			name: collectionName,
			storageMode: StorageMode.Blob,
		});
		done("collection created");

		step(5, 7, "Uploading bytes via publisher HTTP...");
		const payload = new TextEncoder().encode(
			`hello via publisher ${Date.now()}`,
		);
		const blob = await walrus.uploadBlob(payload, {
			epochs: 3,
			deletable: true,
		});
		done(`blobObjectId=${blob.blobObjectId} blobId=${blob.blobId}`);

		step(6, 7, "Adding entry referencing the uploaded blob (1 popup)...");
		const entry = await addEntry(ctx.adapter, ctx.config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			collectionName,
			name: "first-post",
			blobObjectId: blob.blobObjectId,
			contentType: "text/plain",
		});
		entryIds.push(entry.entryId);
		done(`entryId=${entry.entryId}`);

		step(7, 7, "Reading the blob back via aggregator HTTP...");
		const recovered = await reader.readBlob(blob.blobId);
		const recoveredText = new TextDecoder().decode(recovered);
		const expectedText = new TextDecoder().decode(payload);
		if (recoveredText !== expectedText) {
			throw new Error(
				`aggregator round-trip mismatch: expected ${JSON.stringify(expectedText)}, got ${JSON.stringify(recoveredText)}`,
			);
		}
		done(`${recovered.length} bytes match the upload`);

		success = true;
	} finally {
		await cleanupSmokePublication(ctx, {
			created,
			collectionNames: [collectionName],
			entryIdsByCollection: new Map([[collectionName, entryIds]]),
		});
	}

	if (success) {
		console.log("\nPHASE 6 BLOB HTTP SMOKE: PASS");
	}
}

main().catch((error: unknown) => {
	console.error("\nPHASE 6 BLOB HTTP SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
