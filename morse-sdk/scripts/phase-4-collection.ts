#!/usr/bin/env bun
/**
 * Phase 4 smoke: collection lifecycle (create blob + quilt modes, read inline,
 * assert duplicate-name abort, delete both) against the canonical testnet
 * deployment.
 *
 * Required env vars:
 *   PRIVATE_KEY - suiprivkey1... bech32 secret key
 *
 * Optional:
 *   SUI_RPC_URL - override the testnet RPC URL
 *
 * Run from `morse-sdk/`:
 *   bun run examples/phase-4-collection.ts
 */

import { SuiGrpcClient } from "@mysten/sui/grpc";

import {
	ContractAbortError,
	createCollection,
	createPublication,
	deleteCollection,
	deletePublication,
	KeypairAdapter,
	morseConfig,
	RpcPublicationReader,
	StorageMode,
} from "../src/index.js";
import { done, formatMist, readEnv, step } from "./_shared.js";

async function main(): Promise<void> {
	const privateKey = readEnv("PRIVATE_KEY");
	const config = morseConfig({
		network: "testnet",
		...(process.env.SUI_RPC_URL ? { rpcUrl: process.env.SUI_RPC_URL } : {}),
	});
	const slug = `morse-coll-smoke-${Date.now()}`;

	step(1, 7, `Connecting to ${config.rpcUrl}...`);
	const client = new SuiGrpcClient({
		network: "testnet",
		baseUrl: config.rpcUrl,
	});
	done("connected");

	step(2, 7, "Loading wallet adapter from PRIVATE_KEY...");
	const adapter = KeypairAdapter.fromSecretKey(privateKey, client);
	done(`address ${adapter.address}`);

	const reader = new RpcPublicationReader(
		client,
		config.originalPackageId ?? config.packageId,
	);

	step(3, 7, `Creating fresh publication "${slug}"...`);
	const created = await createPublication(adapter, config, {
		name: "Phase 4 Collection Smoke",
		slug,
	});
	done(
		`publicationId=${created.publicationId}, publisherCapId=${created.publisherCapId}`,
	);

	let success = false;
	try {
		step(4, 7, 'Creating a blob-mode collection "blog"...');
		const blogResult = await createCollection(adapter, config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			name: "blog",
			storageMode: StorageMode.Blob,
		});
		done(
			`digest=${blogResult.digest}, gas=${formatMist(blogResult.gasUsedMist)}`,
		);

		step(5, 7, 'Creating a quilt-mode collection "files"...');
		const filesResult = await createCollection(adapter, config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			name: "files",
			storageMode: StorageMode.Quilt,
		});
		done(
			`digest=${filesResult.digest}, gas=${formatMist(filesResult.gasUsedMist)}`,
		);

		step(6, 7, "Reading publication; verifying both collections present...");
		const publication = await reader.getPublication(created.publicationId);
		const blog = publication.collections.find((c) => c.name === "blog");
		const files = publication.collections.find((c) => c.name === "files");
		if (!blog || blog.storageMode !== StorageMode.Blob) {
			throw new Error(
				`Blog collection missing or wrong storage mode: ${JSON.stringify(blog)}`,
			);
		}
		if (!files || files.storageMode !== StorageMode.Quilt) {
			throw new Error(
				`Files collection missing or wrong storage mode: ${JSON.stringify(files)}`,
			);
		}
		done(
			`blog.storageMode=${blog.storageMode}, files.storageMode=${files.storageMode}`,
		);

		console.log(
			'\n  Negative path: try to create another "blog"; expect ECollectionAlreadyExists...',
		);
		try {
			await createCollection(adapter, config, {
				publicationId: created.publicationId,
				publisherCapId: created.publisherCapId,
				name: "blog",
				storageMode: StorageMode.Blob,
			});
			throw new Error(
				"Expected duplicate-name create to abort, but it succeeded",
			);
		} catch (error) {
			if (
				!(error instanceof ContractAbortError) ||
				error.reason !== "ECollectionAlreadyExists"
			) {
				throw error;
			}
			console.log(`  confirmed: ${error.constructor.name} (${error.reason})`);
		}

		step(7, 7, "Deleting both collections...");
		const delBlog = await deleteCollection(adapter, config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			name: "blog",
		});
		const delFiles = await deleteCollection(adapter, config, {
			publicationId: created.publicationId,
			publisherCapId: created.publisherCapId,
			name: "files",
		});
		done(
			`blog deleted (gas=${formatMist(delBlog.gasUsedMist)}), files deleted (gas=${formatMist(delFiles.gasUsedMist)})`,
		);
		success = true;
	} finally {
		console.log("\n  Cleaning up: deleting the test publication...");
		try {
			const cleanup = await deletePublication(reader, adapter, config, {
				publicationId: created.publicationId,
				ownerCapId: created.ownerCapId,
			});
			console.log(
				`  cleanup digest=${cleanup.digest}, gas=${formatMist(cleanup.gasUsedMist)}`,
			);
		} catch (cleanupError) {
			console.error("  cleanup failed:", cleanupError);
		}
	}

	if (success) {
		console.log("\nPHASE 4 SMOKE: PASS");
	}
}

main().catch((error: unknown) => {
	console.error("\nPHASE 4 SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
