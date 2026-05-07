#!/usr/bin/env bun
/**
 * Phase 2 smoke: end-to-end publication CRUD against the canonical testnet
 * deployment (no env-supplied addresses).
 *
 * Required env vars:
 *   PRIVATE_KEY  - suiprivkey1... bech32 secret key (sui keytool export)
 *
 * Optional env vars:
 *   SUI_RPC_URL  - override the public testnet RPC URL
 *
 * Run from `morse-sdk/`:
 *   bun run examples/phase-2-publication.ts
 */

import { SuiGrpcClient } from "@mysten/sui/grpc";

import {
	type CreatePublicationResult,
	createPublication,
	type DeletePublicationResult,
	deletePublication,
	KeypairAdapter,
	morseConfig,
	NotFoundError,
	type OwnedPublication,
	type Publication,
	type PublicationId,
	RpcPublicationReader,
} from "../src/index.js";
import { done, formatMist, readEnv, step } from "./utils.js";

async function main(): Promise<void> {
	const privateKey = readEnv("PRIVATE_KEY");
	const config = morseConfig({
		network: "testnet",
		...(process.env.SUI_RPC_URL ? { rpcUrl: process.env.SUI_RPC_URL } : {}),
	});
	const slug = `morse-smoke-${Date.now()}`;

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

main().catch((error: unknown) => {
	console.error("\nPHASE 2 SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
