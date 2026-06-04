#!/usr/bin/env bun
/**
 * Phase 9 smoke: encrypt a payload via Seal under the allowlist policy,
 * upload ciphertext to Walrus, register an EncryptedFile metadata record,
 * read it back via the files reader, then decrypt with a SessionKey
 * derived from the same keypair (the sender is also a member of the
 * allowlist). Costs real testnet WAL and SUI.
 *
 * Required env vars:
 *   PRIVATE_KEY        - suiprivkey1... bech32 secret key
 * Optional:
 *   SUI_RPC_URL        - override the default testnet RPC URL
 *   SEAL_KEY_SERVERS   - JSON array of {"objectId": "0x...", "weight": 1}
 *   SEAL_THRESHOLD     - integer threshold; overrides default
 */

import { type KeyServerConfig, SessionKey } from "@mysten/seal";
import {
	addMember,
	buildAllowlistSealId,
	createAllowlist,
	DefaultSealAdapter,
	DefaultWalrusWriteAdapter,
	deleteAllowlist,
	deleteFile,
	HttpAggregatorReadAdapter,
	RpcFilesReader,
	uploadEncryptedFileFromBytes,
} from "../src/index.js";
import { buildSmokeContext, done, formatMist, step } from "./_shared.js";

async function main(): Promise<void> {
	const ctx = buildSmokeContext();
	const filesReader = RpcFilesReader.fromMorseConfig(ctx.config, ctx.client);
	const envServers = process.env.SEAL_KEY_SERVERS;
	const overrideServers = envServers ? parseKeyServers(envServers) : undefined;
	const overrideThreshold = process.env.SEAL_THRESHOLD
		? Number(process.env.SEAL_THRESHOLD)
		: undefined;

	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);
	// Reads go through Mysten's aggregator endpoint (built into morseConfig)
	// rather than direct sliver fanout. Direct fanout flakes on testnet due
	// to inconsistent storage-node availability; the aggregator handles the
	// retry / consensus internally and is the recommended read path for
	// testnet smoke tests.
	const walrusRead = HttpAggregatorReadAdapter.fromMorseConfig(
		ctx.config,
		ctx.client,
	);
	const seal = DefaultSealAdapter.fromMorseConfig(
		ctx.config,
		{
			...(overrideServers === undefined
				? {}
				: { serverConfigs: overrideServers }),
			...(overrideThreshold === undefined
				? {}
				: { threshold: overrideThreshold }),
		},
		ctx.client,
	);

	const total = 7;
	const name = `secret-${Date.now()}.txt`;
	const plaintext = new TextEncoder().encode(
		`hello from phase-9 at ${new Date().toISOString()}`,
	);
	let success = false;

	console.log("Phase 9: encrypted-file smoke against testnet");
	console.log(`  sender: ${ctx.adapter.address}`);
	console.log();

	step(1, total, "createAllowlist + addMember(self)");
	const created = await createAllowlist(ctx.adapter, ctx.config, {
		name: `phase-9-${Date.now()}`,
	});
	done(`allowlist=${created.allowlistId}`);
	done(`cap=${created.capId}`);
	done(`gas=${formatMist(created.gasUsedMist)}`);
	const addRes = await addMember(ctx.adapter, ctx.config, {
		allowlistId: created.allowlistId,
		capId: created.capId,
		member: ctx.adapter.address,
	});
	done(`addMember gas=${formatMist(addRes.gasUsedMist)}`);

	try {
		step(2, total, "buildAllowlistSealId(allowlist, randomNonce)");
		const nonce = crypto.getRandomValues(new Uint8Array(16));
		const sealId = buildAllowlistSealId(created.allowlistId, nonce);
		done(`sealId.length=${sealId.length} bytes`);

		step(
			3,
			total,
			"uploadEncryptedFileFromBytes (encrypt -> walrus -> create_file)",
		);
		const upload = await uploadEncryptedFileFromBytes(ctx.adapter, ctx.config, {
			walrus,
			seal,
			allowlistId: created.allowlistId,
			sealId,
			plaintext,
			name,
			contentType: "text/plain",
			upload: { epochs: 2, deletable: true },
			onProgress: (e) => done(`progress: ${e.phase}`),
		});
		done(`fileId=${upload.fileId}`);
		done(`blobId=${upload.blobId}`);
		done(`gas=${formatMist(upload.gasUsedMist)}`);

		step(4, total, "reader.getEncryptedFile");
		const file = await filesReader.getEncryptedFile(upload.fileId);
		done(`name=${file.name}`);
		done(`contentType=${file.contentType}`);
		done(`size=${file.size}`);
		done(`encrypted=${file.encrypted}`);
		done(`allowlistId=${file.allowlistId}`);
		if (!file.encrypted) throw new Error("file should be encrypted");
		if (file.allowlistId === null)
			throw new Error("encrypted file must reference an allowlist");

		step(5, total, "read ciphertext from Walrus");
		const ciphertext = await walrusRead.readBlob(upload.blobId);
		done(`ciphertext=${ciphertext.length} bytes`);

		step(6, total, "decrypt via SessionKey + allowlist seal_approve");
		const sessionKey = await SessionKey.create({
			address: ctx.adapter.address,
			packageId: ctx.config.originalPackageId ?? ctx.config.packageId,
			ttlMin: 10,
			signer: ctx.keypair,
			suiClient: ctx.client,
		});
		const decrypted = await seal.decryptUnderAllowlist(ciphertext, {
			sealId,
			allowlistId: created.allowlistId,
			sessionKey,
		});
		const decryptedText = new TextDecoder().decode(decrypted);
		done(`decrypted=${decrypted.length} bytes`);
		done(`text=${JSON.stringify(decryptedText)}`);
		if (decryptedText !== new TextDecoder().decode(plaintext)) {
			throw new Error("decrypted text does not match plaintext");
		}

		step(7, total, "cleanup: deleteFile + deleteAllowlist");
		const delFile = await deleteFile(ctx.adapter, ctx.config, {
			fileId: upload.fileId,
		});
		done(`deleteFile gas=${formatMist(delFile.gasUsedMist)}`);

		success = true;
	} finally {
		try {
			const delAl = await deleteAllowlist(ctx.adapter, ctx.config, {
				allowlistId: created.allowlistId,
				capId: created.capId,
			});
			done(`deleteAllowlist gas=${formatMist(delAl.gasUsedMist)}`);
		} catch (error) {
			console.error("    failed to delete allowlist:", error);
		}
	}

	if (success) {
		console.log("\nPHASE 9 ENCRYPTED-FILE SMOKE: PASS");
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
			throw new Error(`SEAL_KEY_SERVERS[${i}] must be { objectId, weight }`);
		}
		return { objectId: e.objectId, weight: e.weight };
	});
}

main().catch((error) => {
	console.error("\nPHASE 9 ENCRYPTED-FILE SMOKE: FAIL");
	console.error(error);
	process.exit(1);
});
