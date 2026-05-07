#!/usr/bin/env bun
/**
 * Phase 3 smoke script: PublisherCap lifecycle (issue, list, read, revoke,
 * destroy) end-to-end against a Sui network.
 *
 * Required env vars:
 *   PRIVATE_KEY - suiprivkey1... bech32 secret key (sui keytool export)
 *   PACKAGE_ID  - current `published-at` address (Move call target)
 *   REGISTRY_ID - deployed PublicationRegistry shared object ID
 *
 * Optional env vars:
 *   ORIGINAL_PACKAGE_ID - `original-id` from Published.toml; defaults to PACKAGE_ID
 *   SUI_RPC_URL         - defaults to DEFAULT_RPC_URLS.testnet
 *
 * Run from `morse-sdk/`:
 *   bun run examples/phase-3-cap.ts
 */

import { SuiGrpcClient } from "@mysten/sui/grpc";

import {
	createPublication,
	DEFAULT_RPC_URLS,
	deletePublication,
	destroyPublisherCap,
	issuePublisherCap,
	KeypairAdapter,
	NotFoundError,
	type PackageId,
	type PublisherCap,
	type PublisherCapId,
	type RegistryId,
	RpcPublicationReader,
	revokePublisherCap,
	toPackageId,
	toRegistryId,
} from "../src/index.js";

interface Config {
	readonly packageId: PackageId;
	readonly originalPackageId: PackageId;
	readonly registryId: RegistryId;
}

async function main(): Promise<void> {
	const privateKey = readEnv("PRIVATE_KEY");
	const packageId = toPackageId(readEnv("PACKAGE_ID"));
	const originalPackageIdRaw = process.env.ORIGINAL_PACKAGE_ID;
	const originalPackageId = originalPackageIdRaw
		? toPackageId(originalPackageIdRaw)
		: packageId;
	const registryId = toRegistryId(readEnv("REGISTRY_ID"));
	const rpcUrl = process.env.SUI_RPC_URL ?? DEFAULT_RPC_URLS.testnet;
	const slug = `morse-cap-smoke-${Date.now()}`;

	step(1, 7, `Connecting to ${rpcUrl}...`);
	const client = new SuiGrpcClient({ network: "testnet", baseUrl: rpcUrl });
	done("connected");

	step(2, 7, "Loading wallet adapter from PRIVATE_KEY...");
	const adapter = KeypairAdapter.fromSecretKey(privateKey, client);
	done(`address ${adapter.address}`);

	const reader = new RpcPublicationReader(client, originalPackageId);
	const config: Config = { packageId, originalPackageId, registryId };

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

function step(index: number, total: number, message: string): void {
	console.log(`[${index}/${total}] ${message}`);
}

function done(message: string): void {
	console.log(`        ${message}`);
}

function readEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
	return value;
}

function formatMist(mist: bigint): string {
	const negative = mist < 0n;
	const abs = negative ? -mist : mist;
	const whole = abs / 1_000_000_000n;
	const frac = abs % 1_000_000_000n;
	const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
	const value = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
	return `${negative ? "-" : ""}${value} SUI`;
}

main().catch((error: unknown) => {
	console.error("\nPHASE 3 SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
