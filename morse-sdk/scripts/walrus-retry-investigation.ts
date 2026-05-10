#!/usr/bin/env bun

/**
 * Walrus retry investigation: 10 sequential trials of `uploadBlob`, up to
 * 3 attempts each, no backoff. Reports attempts-to-success distribution.
 *
 * Used to answer the SDK agent's brief: is `NotEnoughBlobConfirmationsError`
 * a transient flake (naive retry succeeds), a slow-recovery flake (backoff
 * helps), or a sustained committee outage (retry doesn't help)?
 *
 * Required env vars:
 *   PRIVATE_KEY  - suiprivkey1... (testnet SUI + WAL)
 * Optional:
 *   SUI_RPC_URL
 *   TRIALS       - default 10
 *   ATTEMPTS     - default 3
 *
 * Run from morse-sdk/:
 *   bun run scripts/walrus-retry-investigation.ts
 */

import { DefaultWalrusWriteAdapter } from "../src/index.js";
import { buildSmokeContext, done, step } from "./_shared.js";

interface TrialResult {
	readonly trial: number;
	readonly attemptsTaken: number;
	readonly success: boolean;
	readonly blobObjectId?: string;
	readonly errorChain?: string;
}

function describeError(err: unknown): string {
	const lines: string[] = [];
	let cur: unknown = err;
	let depth = 0;
	while (cur != null && depth < 5) {
		if (cur instanceof Error) {
			lines.push(`[${cur.constructor.name}] ${cur.message}`);
			cur = (cur as Error & { cause?: unknown }).cause;
		} else {
			lines.push(`[${typeof cur}] ${String(cur)}`);
			cur = null;
		}
		depth += 1;
	}
	return lines.join(" -> ");
}

function isFlake(err: unknown): boolean {
	let cur: unknown = err;
	let depth = 0;
	while (cur != null && depth < 5) {
		if (cur instanceof Error) {
			if (cur.name === "NotEnoughBlobConfirmationsError") return true;
			cur = (cur as Error & { cause?: unknown }).cause;
		} else {
			cur = null;
		}
		depth += 1;
	}
	return false;
}

async function main(): Promise<void> {
	const TRIALS = Number(process.env.TRIALS ?? "10");
	const ATTEMPTS = Number(process.env.ATTEMPTS ?? "3");
	const ctx = buildSmokeContext();
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);

	step(1, TRIALS + 1, `Connected; address ${ctx.adapter.address}`);
	done(`rpc=${ctx.config.rpcUrl}`);
	done(`config: TRIALS=${TRIALS} ATTEMPTS=${ATTEMPTS}`);

	const results: TrialResult[] = [];
	for (let trial = 1; trial <= TRIALS; trial++) {
		const bytes = new TextEncoder().encode(
			`retry-investigation-${trial}-${Date.now()}`,
		);
		step(trial + 1, TRIALS + 1, `Trial ${trial}/${TRIALS}`);
		let trialResult: TrialResult | null = null;
		for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
			const start = Date.now();
			try {
				const blob = await walrus.uploadBlob(bytes, {
					epochs: 3,
					deletable: true,
				});
				const elapsed = ((Date.now() - start) / 1000).toFixed(1);
				done(
					`attempt ${attempt}: OK in ${elapsed}s -> ${blob.blobObjectId}`,
				);
				trialResult = {
					trial,
					attemptsTaken: attempt,
					success: true,
					blobObjectId: blob.blobObjectId,
				};
				break;
			} catch (err) {
				const elapsed = ((Date.now() - start) / 1000).toFixed(1);
				const flake = isFlake(err);
				done(
					`attempt ${attempt}: FAIL in ${elapsed}s (flake=${flake}) ${describeError(err)}`,
				);
				if (!flake || attempt === ATTEMPTS) {
					trialResult = {
						trial,
						attemptsTaken: attempt,
						success: false,
						errorChain: describeError(err),
					};
					break;
				}
			}
		}
		if (trialResult === null) {
			throw new Error(`unreachable: trial ${trial} produced no result`);
		}
		results.push(trialResult);
	}

	console.log("\n=== Distribution ===");
	const successful = results.filter((r) => r.success);
	const failed = results.filter((r) => !r.success);
	const buckets = new Map<number, number>();
	for (const r of successful) {
		buckets.set(r.attemptsTaken, (buckets.get(r.attemptsTaken) ?? 0) + 1);
	}
	for (let i = 1; i <= ATTEMPTS; i++) {
		console.log(
			`  ${i} attempt${i > 1 ? "s" : ""}: ${buckets.get(i) ?? 0} / ${TRIALS}`,
		);
	}
	console.log(`  failed:    ${failed.length} / ${TRIALS}`);
	console.log(
		`  success rate: ${successful.length}/${TRIALS} = ${((successful.length / TRIALS) * 100).toFixed(0)}%`,
	);

	if (failed.length > 0) {
		console.log("\n=== Failed trials ===");
		for (const r of failed) {
			console.log(`  Trial ${r.trial}: ${r.errorChain}`);
		}
	}

	// Recommendation hint based on the distribution.
	console.log("\n=== Hint ===");
	if (successful.length === 0) {
		console.log(
			"  All trials failed. Looks like a sustained outage or misconfig.",
		);
		console.log(
			"  Try variants (backoff, fresh client, lower epochs) or check Walrus testnet status.",
		);
	} else if (successful.length / TRIALS >= 0.9) {
		console.log("  >=90% success at attempt 1; the failure mode in phase-6 may have");
		console.log("  recovered between sessions. Re-run phase-6-blob.ts to confirm.");
	} else if (
		successful.length / TRIALS >= 0.6 &&
		(buckets.get(2) ?? 0) + (buckets.get(3) ?? 0) > 0
	) {
		console.log("  Naive retry meaningfully improves success rate.");
		console.log(
			"  Recommend: SDK adds optional `retries` to WalrusUploadCommonOptions.",
		);
	} else {
		console.log("  Retry alone doesn't reliably clear the failure.");
		console.log(
			"  Suggest variants (backoff, fresh client, lower epochs) or upstream check.",
		);
	}
}

main().catch((error: unknown) => {
	console.error("\nWALRUS RETRY INVESTIGATION: FAIL");
	console.error(error);
	process.exit(1);
});
