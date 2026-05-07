#!/usr/bin/env bun

/**
 * Phase 6 quilt-mode smoke: upload a quilt with two patches, add one entry
 * per patch into a `StorageMode.Quilt` collection. Doubles as the Phase 5
 * real-testnet quilt round-trip validation.
 *
 * Failures of `NotEnoughBlobConfirmationsError` are testnet committee flakes;
 * rerun.
 *
 * Required env vars:
 *   PRIVATE_KEY  - suiprivkey1... bech32 secret key (must hold testnet SUI and WAL)
 * Optional:
 *   SUI_RPC_URL  - override the default testnet RPC URL
 *
 * Run from `morse-sdk/`:
 *   bun run scripts/phase-6-quilt.ts
 */

import { done, formatMist, step } from "../examples/utils.js";
import {
	addEntry,
	createCollection,
	createPublication,
	DefaultWalrusWriteAdapter,
	StorageMode,
} from "../src/index.js";
import { buildSmokeContext, cleanupSmokePublication } from "./_shared.js";

async function main(): Promise<void> {
	const ctx = buildSmokeContext();
	const slug = `morse-entry-quilt-${Date.now()}`;

	step(1, 7, `Connected; address ${ctx.adapter.address}`);
	done(`rpc=${ctx.config.rpcUrl}`);

	step(2, 7, "Building Walrus write adapter (testnet)...");
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);
	done("adapter ready");

	step(3, 7, `Creating publication "${slug}"...`);
	const created = await createPublication(ctx.adapter, ctx.config, {
		name: "Phase 6 Quilt Smoke",
		slug,
	});
	done(`publicationId=${created.publicationId}`);

	const collectionName = "files";
	const entryIds: number[] = [];

	let success = false;
	try {
		step(4, 7, `Creating quilt-mode collection "${collectionName}"...`);
		await createCollection(ctx.adapter, ctx.config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			name: collectionName,
			storageMode: StorageMode.Quilt,
		});
		done("collection created");

		step(5, 7, "Uploading quilt with 2 patches...");
		const nonce = Date.now();
		const quilt = await walrus.uploadQuilt(
			[
				{
					contents: new TextEncoder().encode(`patch-1-${nonce}`),
					identifier: `first-${nonce}`,
				},
				{
					contents: new TextEncoder().encode(`patch-2-${nonce}`),
					identifier: `second-${nonce}`,
				},
			],
			{ epochs: 3, deletable: true },
		);
		done(`blobObjectId=${quilt.blobObjectId} patches=${quilt.patches.length}`);

		step(6, 7, "Adding 2 entries (one per patch) into the quilt collection...");
		for (const [i, patch] of quilt.patches.entries()) {
			const result = await addEntry(ctx.adapter, ctx.config, {
				publicationId: created.publicationId,
				publisherCapId: created.publisherCapId,
				collectionName,
				name: patch.identifier,
				blobObjectId: quilt.blobObjectId,
				quiltPatchId: patch.patchId,
				contentType: "application/octet-stream",
			});
			entryIds.push(result.entryId);
			console.log(
				`        [${i + 1}/${quilt.patches.length}] entryId=${result.entryId} gas=${formatMist(result.gasUsedMist)}`,
			);
		}

		step(
			7,
			7,
			"Reading entries back; expecting BlobRef::QuiltPatch on each...",
		);
		for (const entryId of entryIds) {
			const entry = await ctx.reader.getEntry(
				created.publicationId,
				collectionName,
				entryId,
			);
			const ref = entry.revisions[0]?.blobRef;
			if (ref?.kind !== "quilt") {
				throw new Error(
					`Entry ${entryId} should have quilt-mode BlobRef, got ${ref?.kind}`,
				);
			}
			if (ref.patchId.length !== 37) {
				throw new Error(
					`Entry ${entryId} patchId wrong length: ${ref.patchId.length}`,
				);
			}
			console.log(
				`        entry ${entryId}: name="${entry.name}" patchId=${ref.patchId.length} bytes`,
			);
		}

		success = true;
	} finally {
		await cleanupSmokePublication(ctx, {
			created,
			collectionNames: [collectionName],
			entryIdsByCollection: new Map([[collectionName, entryIds]]),
		});
	}

	if (success) {
		console.log("\nPHASE 6 QUILT SMOKE: PASS");
	}
}

main().catch((error: unknown) => {
	console.error("\nPHASE 6 QUILT SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
