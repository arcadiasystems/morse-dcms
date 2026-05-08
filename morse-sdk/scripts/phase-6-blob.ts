#!/usr/bin/env bun

/**
 * Phase 6 blob-mode smoke: end-to-end entry/revision lifecycle in a
 * `StorageMode.Blob` collection. Costs real testnet WAL and SUI.
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
 *   bun run scripts/phase-6-blob.ts
 */

import {
	addEntry,
	appendDraftRevision,
	createCollection,
	createPublication,
	DefaultWalrusWriteAdapter,
	publishFromDraft,
	StorageMode,
} from "../src/index.js";
import {
	buildSmokeContext,
	cleanupSmokePublication,
	done,
	formatMist,
	step,
} from "./_shared.js";

async function main(): Promise<void> {
	const ctx = buildSmokeContext();
	const slug = `morse-entry-blob-${Date.now()}`;

	step(1, 8, `Connected; address ${ctx.adapter.address}`);
	done(`rpc=${ctx.config.rpcUrl}`);

	step(2, 8, "Building Walrus write adapter (testnet)...");
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);
	done("adapter ready");

	step(3, 8, `Creating publication "${slug}"...`);
	const created = await createPublication(ctx.adapter, ctx.config, {
		name: "Phase 6 Blob Smoke",
		slug,
	});
	done(`publicationId=${created.publicationId}`);

	const collectionName = "blog";
	const entryIds: number[] = [];

	let success = false;
	try {
		step(4, 8, `Creating blob-mode collection "${collectionName}"...`);
		await createCollection(ctx.adapter, ctx.config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			name: collectionName,
			storageMode: StorageMode.Blob,
		});
		done("collection created");

		step(5, 8, "Uploading first blob...");
		const blob1 = await walrus.uploadBlob(
			new TextEncoder().encode(`hello-morse-blob-1-${Date.now()}`),
			{ epochs: 3, deletable: true },
		);
		done(`blobObjectId=${blob1.blobObjectId}`);

		step(6, 8, "Adding entry with blob1 as the first revision...");
		const added = await addEntry(ctx.adapter, ctx.config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			collectionName,
			name: "first-post",
			blobObjectId: blob1.blobObjectId,
			contentType: "text/plain",
		});
		entryIds.push(added.entryId);
		done(
			`entryId=${added.entryId} revisionId=${added.revisionId} gas=${formatMist(added.gasUsedMist)}`,
		);

		step(7, 8, "Uploading second blob, appending as draft, then publishing...");
		const blob2 = await walrus.uploadBlob(
			new TextEncoder().encode(`hello-morse-blob-2-${Date.now()}`),
			{ epochs: 3, deletable: true },
		);
		const draft = await appendDraftRevision(ctx.adapter, ctx.config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			collectionName,
			entryId: added.entryId,
			blobObjectId: blob2.blobObjectId,
			contentType: "text/plain",
		});
		const published = await publishFromDraft(ctx.adapter, ctx.config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			collectionName,
			entryId: added.entryId,
			draftRevisionId: draft.revisionId,
			blobObjectId: blob2.blobObjectId,
			contentType: "text/plain",
		});
		done(
			`draftRevisionId=${draft.revisionId} publishedRevisionId=${published.revisionId}`,
		);

		step(
			8,
			8,
			"Reading entry back; expecting 3 revisions and public_head=2...",
		);
		const entry = await ctx.reader.getEntry(
			created.publicationId,
			collectionName,
			added.entryId,
		);
		if (entry.revisions.length !== 3) {
			throw new Error(`expected 3 revisions, got ${entry.revisions.length}`);
		}
		if (entry.publicHead !== published.revisionId) {
			throw new Error(
				`expected publicHead=${published.revisionId}, got ${entry.publicHead}`,
			);
		}
		if (entry.revisions[0]?.blobRef.kind !== "blob") {
			throw new Error("expected blob-mode BlobRef on first revision");
		}
		done(
			`name="${entry.name}" revisions=${entry.revisions.length} publicHead=${entry.publicHead} draftHead=${entry.draftHead ?? "null"}`,
		);

		success = true;
	} finally {
		await cleanupSmokePublication(ctx, {
			created,
			collectionNames: [collectionName],
			entryIdsByCollection: new Map([[collectionName, entryIds]]),
		});
	}

	if (success) {
		console.log("\nPHASE 6 BLOB SMOKE: PASS");
	}
}

main().catch((error: unknown) => {
	console.error("\nPHASE 6 BLOB SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
