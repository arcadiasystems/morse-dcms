#!/usr/bin/env bun
/**
 * Phase 2 smoke script. Runs createPublication, getPublication,
 * listPublicationsOwnedBy, deletePublication, and a confirmation read
 * end-to-end against a Sui network.
 *
 * Required env vars:
 *   PRIVATE_KEY          - suiprivkey1... bech32 secret key (sui keytool export)
 *   PACKAGE_ID           - current `published-at` address (Move call target)
 *   REGISTRY_ID          - deployed PublicationRegistry shared object ID
 *
 * Optional env vars:
 *   ORIGINAL_PACKAGE_ID  - `original-id` from Published.toml; defaults to PACKAGE_ID
 *   SUI_RPC_URL          - defaults to DEFAULT_RPC_URLS.testnet
 *
 * Run from `morse-sdk/`:
 *   bun run examples/phase-2-publication.ts
 */

import { SuiGrpcClient } from "@mysten/sui/grpc";

import {
	type CreatePublicationResult,
	createPublication,
	DEFAULT_RPC_URLS,
	type DeletePublicationResult,
	deletePublication,
	KeypairAdapter,
	NotFoundError,
	type OwnedPublication,
	type PackageId,
	type Publication,
	type PublicationId,
	type RegistryId,
	RpcPublicationReader,
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
	const originalPackageIdRaw = process.env["ORIGINAL_PACKAGE_ID"];
	const originalPackageId = originalPackageIdRaw
		? toPackageId(originalPackageIdRaw)
		: packageId;
	const registryId = toRegistryId(readEnv("REGISTRY_ID"));
	const rpcUrl = process.env["SUI_RPC_URL"] ?? DEFAULT_RPC_URLS.testnet;
	const slug = `morse-smoke-${Date.now()}`;

	step(1, 7, `Connecting to ${rpcUrl}...`);
	const client = new SuiGrpcClient({ network: "testnet", baseUrl: rpcUrl });
	done("connected");

	step(2, 7, "Loading wallet adapter from PRIVATE_KEY...");
	const adapter = KeypairAdapter.fromSecretKey(privateKey, client);
	done(`address ${adapter.address}`);

	const reader = new RpcPublicationReader(client, originalPackageId);
	const config: Config = { packageId, originalPackageId, registryId };

	step(3, 7, `Creating publication with slug "${slug}"...`);
	const created = await createPublication(adapter, config, {
		name: "Phase 2 Smoke Test",
		slug,
	});
	logCreate(created);

	step(4, 7, "Reading publication back...");
	const fetched = await reader.getPublication(created.publicationId);
	assertSlug(fetched, slug);
	done(
		`name="${fetched.name}" slug="${fetched.slug}" collections=${fetched.collections.length}`,
	);

	step(5, 7, "Listing publications owned by this address...");
	const page = await reader.listPublicationsOwnedBy(adapter.address);
	assertOwnsPublication(page.results, created.publicationId);
	done(`${page.results.length} owned on this page; new one present`);

	step(6, 7, "Deleting publication...");
	const deleted = await deletePublication(reader, adapter, config, {
		publicationId: created.publicationId,
		ownerCapId: created.ownerCapId,
	});
	logDelete(deleted);

	step(7, 7, "Verifying publication is gone...");
	await assertDeleted(reader, created.publicationId);

	console.log("\nPHASE 2 SMOKE: PASS");
}

function logCreate(result: CreatePublicationResult): void {
	console.log(`        publicationId:  ${result.publicationId}`);
	console.log(`        ownerCapId:     ${result.ownerCapId}`);
	console.log(`        publisherCapId: ${result.publisherCapId}`);
	console.log(`        digest:         ${result.digest}`);
	console.log(`        gas:            ${formatMist(result.gasUsedMist)}`);
}

function logDelete(result: DeletePublicationResult): void {
	console.log(`        digest: ${result.digest}`);
	console.log(`        gas:    ${formatMist(result.gasUsedMist)}`);
}

async function assertDeleted(
	reader: RpcPublicationReader,
	publicationId: PublicationId,
): Promise<void> {
	try {
		await reader.getPublication(publicationId);
	} catch (error) {
		if (error instanceof NotFoundError) {
			done(`confirmed: ${error.constructor.name}`);
			return;
		}
		throw error;
	}
	throw new Error("Publication still exists after delete");
}

function assertSlug(publication: Publication, expected: string): void {
	if (publication.slug !== expected) {
		throw new Error(
			`Slug round-trip failed: expected "${expected}", got "${publication.slug}"`,
		);
	}
}

function assertOwnsPublication(
	owned: readonly OwnedPublication[],
	expected: PublicationId,
): void {
	if (!owned.some((o) => o.publicationId === expected)) {
		throw new Error(
			`New publication ${expected} not present in owned list (page had ${owned.length} entries)`,
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
	console.error("\nPHASE 2 SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
