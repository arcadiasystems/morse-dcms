#!/usr/bin/env bun
/**
 * Phase 3 smoke: PublisherCap lifecycle (issue, list, read, revoke, destroy)
 * against the canonical testnet deployment.
 *
 * Required env vars:
 *   PRIVATE_KEY - suiprivkey1... bech32 secret key
 *
 * Optional:
 *   SUI_RPC_URL - override the testnet RPC URL
 *
 * Run from `morse-sdk/`:
 *   bun run examples/phase-3-cap.ts
 */

import { SuiGrpcClient } from "@mysten/sui/grpc";

import {
	createPublication,
	deletePublication,
	destroyPublisherCap,
	issuePublisherCap,
	KeypairAdapter,
	morseConfig,
	NotFoundError,
	type PublisherCap,
	type PublisherCapId,
	RpcPublicationReader,
	revokePublisherCap,
} from "../src/index.js";
import { done, formatMist, readEnv, step } from "./utils.js";

async function main(): Promise<void> {
	const privateKey = readEnv("PRIVATE_KEY");
	const config = morseConfig({
		network: "testnet",
		...(process.env.SUI_RPC_URL ? { rpcUrl: process.env.SUI_RPC_URL } : {}),
	});
	const slug = `morse-cap-smoke-${Date.now()}`;

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

	step(3, 7, `Creating fresh publication "${slug}" for cap testing...`);
	const created = await createPublication(adapter, config, {
		name: "Phase 3 Cap Smoke",
		slug,
	});
	done(
		`publicationId=${created.publicationId}, ownerCapId=${created.ownerCapId}`,
	);

	let success = false;
	try {
		step(4, 7, "Issuing a new PublisherCap to adapter address...");
		const issued = await issuePublisherCap(adapter, config, {
			publicationId: created.publicationId,
			ownerCapId: created.ownerCapId,
			holder: adapter.address,
		});
		done(
			`publisherCapId=${issued.publisherCapId}, gas=${formatMist(issued.gasUsedMist)}`,
		);

		step(5, 7, "Reading cap back and confirming holder...");
		const cap = await reader.getPublisherCap(issued.publisherCapId);
		assertHolder(cap, adapter.address);
		const owned = await reader.listPublisherCapsOwnedBy(adapter.address);
		assertOwnsCap(owned.results, issued.publisherCapId);
		done(
			`holder=${cap.holder}, ${owned.results.length} caps owned on this page (new one present)`,
		);

		step(6, 7, "Revoking the cap...");
		const revoked = await revokePublisherCap(adapter, config, {
			publicationId: created.publicationId,
			ownerCapId: created.ownerCapId,
			publisherCapId: issued.publisherCapId,
		});
		done(`digest=${revoked.digest}, gas=${formatMist(revoked.gasUsedMist)}`);

		step(7, 7, "Destroying the (revoked) cap and verifying gone...");
		const destroyed = await destroyPublisherCap(adapter, config, {
			publicationId: created.publicationId,
			publisherCapId: issued.publisherCapId,
		});
		done(
			`digest=${destroyed.digest}, gas=${formatMist(destroyed.gasUsedMist)}`,
		);
		await assertCapGone(reader, issued.publisherCapId);
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
		console.log("\nPHASE 3 SMOKE: PASS");
	}
}

async function assertCapGone(
	reader: RpcPublicationReader,
	id: PublisherCapId,
): Promise<void> {
	try {
		await reader.getPublisherCap(id);
	} catch (error) {
		if (error instanceof NotFoundError) {
			console.log(`        confirmed: ${error.constructor.name}`);
			return;
		}
		throw error;
	}
	throw new Error("PublisherCap still exists after destroy");
}

function assertHolder(cap: PublisherCap, expected: string): void {
	if (cap.holder !== expected) {
		throw new Error(
			`Cap holder mismatch: expected ${expected}, got ${cap.holder}`,
		);
	}
}

function assertOwnsCap(
	owned: ReadonlyArray<PublisherCap>,
	expected: PublisherCapId,
): void {
	if (!owned.some((c) => c.id === expected)) {
		throw new Error(
			`New cap ${expected} not present in owned list (page had ${owned.length} entries)`,
		);
	}
}

main().catch((error: unknown) => {
	console.error("\nPHASE 3 SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
