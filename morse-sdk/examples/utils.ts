/**
 * Shared helpers for the Phase smoke scripts. Not part of the published SDK.
 */

/** Format a Mist amount as a SUI decimal string. */
export function formatMist(mist: bigint): string {
	const negative = mist < 0n;
	const abs = negative ? -mist : mist;
	const whole = abs / 1_000_000_000n;
	const frac = abs % 1_000_000_000n;
	const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
	const value = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
	return `${negative ? "-" : ""}${value} SUI`;
}

/** Read a required env var or exit. */
export function readEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
	return value;
}

/** Print a numbered step header. */
export function step(index: number, total: number, message: string): void {
	console.log(`[${index}/${total}] ${message}`);
}

/** Print an indented status line under the current step. */
export function done(message: string): void {
	console.log(`        ${message}`);
}
