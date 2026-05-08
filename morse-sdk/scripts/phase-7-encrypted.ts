#!/usr/bin/env bun
/**
 * Phase 7 smoke: encrypt a payload via Seal, upload ciphertext to Walrus,
 * add an encrypted entry, read it back, then decrypt with a SessionKey
 * derived from the same keypair. Costs real testnet WAL and SUI.
 *
 * The wallet here is a raw `Ed25519Keypair` so the smoke can sign Seal's
 * personal-message session-key challenge directly. Production consumers in
 * a browser context use a wallet-standard signer, not a raw keypair; the
 * SDK never silently constructs a SessionKey from private material.
 *
 * `NotEnoughBlobConfirmationsError` is a Walrus testnet committee flake.
 *
 * Required env vars:
 *   PRIVATE_KEY        - suiprivkey1... bech32 secret key
 *   SEAL_KEY_SERVERS   - JSON array of {"objectId": "0x...", "weight": 1}
 *                        entries; consult the Mysten Seal docs for the
 *                        current testnet allowlist.
 * Optional:
 *   SUI_RPC_URL        - override the default testnet RPC URL
 *   SEAL_THRESHOLD     - integer threshold (default 2)
 */

import { type KeyServerConfig, SessionKey } from "@mysten/seal";
import {
	addEncryptedEntry,
	buildPublisherSealId,
	createCollection,
	createPublication,
	DefaultSealAdapter,
	DefaultWalrusWriteAdapter,
	StorageMode,
} from "../src/index.js";
import {
	buildSmokeContext,
	cleanupSmokePublication,
	done,
	readEnv,
	step,
} from "./_shared.js";

async function main(): Promise<void> {
	const ctx = buildSmokeContext();
	const slug = `morse-entry-encrypted-${Date.now()}`;
	const serverConfigs = parseKeyServers(readEnv("SEAL_KEY_SERVERS"));
	const threshold = Number(process.env.SEAL_THRESHOLD ?? "2");
	if (!Number.isInteger(threshold) || threshold < 1) {
		throw new Error(`Invalid SEAL_THRESHOLD: ${process.env.SEAL_THRESHOLD}`);
	}

	step(1, 9, `Connected; address ${ctx.adapter.address}`);
	done(`rpc=${ctx.config.rpcUrl}`);

	step(2, 9, "Building Walrus and Seal adapters (testnet)...");
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);
	const seal = DefaultSealAdapter.fromConfig(
		{
			packageId: ctx.config.originalPackageId ?? ctx.config.packageId,
			serverConfigs,
			threshold,
		},
		ctx.client,
	);
	done(`seal threshold=${threshold} servers=${serverConfigs.length}`);

	step(3, 9, `Creating publication "${slug}"...`);
	const created = await createPublication(ctx.adapter, ctx.config, {
		name: "Phase 7 Encrypted Smoke",
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
			`hello-morse-encrypted-${Date.now()}`,
		);
		const nonce = crypto.getRandomValues(new Uint8Array(16));
		const sealId = buildPublisherSealId(created.publicationId, nonce);

		step(5, 9, "Encrypting via Seal...");
		const { ciphertext } = await seal.encrypt(plaintext, { sealId });
		done(`ciphertext=${ciphertext.length} bytes`);

		step(6, 9, "Uploading ciphertext to Walrus...");
		const blob = await walrus.uploadBlob(ciphertext, {
			epochs: 3,
			deletable: true,
		});
		done(`blobObjectId=${blob.blobObjectId}`);

		step(7, 9, "Adding encrypted entry...");
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
		done(`entryId=${added.entryId} revisionId=${added.revisionId}`);

		step(
			8,
			9,
			"Reading entry back; verifying encrypted=true and sealId match...",
		);
		const entry = await ctx.reader.getEntry(
			created.publicationId,
			collectionName,
			added.entryId,
		);
		const revision = entry.revisions[added.revisionId];
		if (!revision) {
			throw new Error(`revision ${added.revisionId} missing on entry`);
		}
		if (!revision.encrypted) {
			throw new Error("expected encrypted=true on revision");
		}
		if (!revision.sealId) {
			throw new Error("expected sealId to be set on encrypted revision");
		}
		if (!bytesEqual(revision.sealId, sealId)) {
			throw new Error("sealId on revision does not match the one we built");
		}
		done(`name="${entry.name}" sealId=${revision.sealId.length} bytes`);

		step(9, 9, "Decrypting via SessionKey...");
		const sessionKey = await SessionKey.create({
			address: ctx.adapter.address,
			packageId: ctx.config.originalPackageId ?? ctx.config.packageId,
			ttlMin: 10,
			signer: ctx.keypair,
			suiClient: ctx.client,
		});
		const recovered = await seal.decrypt(ciphertext, {
			sessionKey,
			sealId,
			publisherCapId: created.publisherCapId,
		});
		if (!bytesEqual(recovered, plaintext)) {
			throw new Error("decrypted plaintext does not match original");
		}
		done(`decrypted ${recovered.length} bytes; matches original`);

		success = true;
	} finally {
		await cleanupSmokePublication(ctx, {
			created,
			collectionNames: [collectionName],
			entryIdsByCollection: new Map([[collectionName, entryIds]]),
		});
	}

	if (success) {
		console.log("\nPHASE 7 ENCRYPTED SMOKE: PASS");
	}
}

function parseKeyServers(raw: string): KeyServerConfig[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new Error(`SEAL_KEY_SERVERS is not valid JSON: ${String(cause)}`);
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error(
			"SEAL_KEY_SERVERS must be a non-empty JSON array of { objectId, weight }",
		);
	}
	return parsed.map((entry, i) => {
		if (!entry || typeof entry !== "object") {
			throw new Error(`SEAL_KEY_SERVERS[${i}] is not an object`);
		}
		const e = entry as Record<string, unknown>;
		if (typeof e.objectId !== "string" || typeof e.weight !== "number") {
			throw new Error(
				`SEAL_KEY_SERVERS[${i}] must have string objectId and number weight`,
			);
		}
		return { objectId: e.objectId, weight: e.weight };
	});
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

main().catch((error: unknown) => {
	console.error("\nPHASE 7 ENCRYPTED SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
