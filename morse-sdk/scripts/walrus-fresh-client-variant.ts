#!/usr/bin/env bun

/**
 * Walrus retry variant: fresh `DefaultWalrusWriteAdapter` (and underlying
 * `WalrusClient`) per upload. Tests the hypothesis that internal client
 * state poisons subsequent uploads after the first success.
 *
 * Companion to walrus-retry-investigation.ts. Run the same address.
 *
 * Required env vars: PRIVATE_KEY (testnet SUI + WAL).
 * Optional: SUI_RPC_URL, TRIALS (default 5).
 *
 * Run from morse-sdk/:
 *   bun run scripts/walrus-fresh-client-variant.ts
 */

import { DefaultWalrusWriteAdapter } from "../src/index.js";
import { buildSmokeContext, done, step } from "./_shared.js";

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

async function main(): Promise<void> {
	const TRIALS = Number(process.env.TRIALS ?? "5");
	const ctx = buildSmokeContext();

	step(1, TRIALS + 1, `Connected; address ${ctx.adapter.address}`);
	done(`rpc=${ctx.config.rpcUrl}`);
	done(`config: TRIALS=${TRIALS}, fresh client per upload`);

	let succeeded = 0;
	let failed = 0;
	for (let trial = 1; trial <= TRIALS; trial++) {
		step(trial + 1, TRIALS + 1, `Trial ${trial}/${TRIALS}`);
		const walrus = DefaultWalrusWriteAdapter.fromConfig(
			{ network: "testnet", suiClient: ctx.client },
			ctx.keypair,
		);
		const bytes = new TextEncoder().encode(
			`fresh-client-variant-${trial}-${Date.now()}`,
		);
		const start = Date.now();
		try {
			const blob = await walrus.uploadBlob(bytes, {
				epochs: 3,
				deletable: true,
			});
			const elapsed = ((Date.now() - start) / 1000).toFixed(1);
			done(`OK in ${elapsed}s -> ${blob.blobObjectId}`);
			succeeded += 1;
		} catch (err) {
			const elapsed = ((Date.now() - start) / 1000).toFixed(1);
			done(`FAIL in ${elapsed}s ${describeError(err)}`);
			failed += 1;
		}
	}

	console.log(`\n=== Distribution (fresh client per upload) ===`);
	console.log(`  succeeded: ${succeeded}/${TRIALS}`);
	console.log(`  failed:    ${failed}/${TRIALS}`);
	console.log(
		`  success rate: ${((succeeded / TRIALS) * 100).toFixed(0)}%`,
	);
}

main().catch((error: unknown) => {
	console.error("\nFRESH CLIENT VARIANT: FAIL");
	console.error(error);
	process.exit(1);
});
