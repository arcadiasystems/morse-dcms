/** Root command assembly: name, version, and the global options every command shares. */

import { Command } from "commander";

import pkg from "../../package.json" with { type: "json" };

/** Options defined on the root command, available to every subcommand. */
/**
 * Default ceiling for a relay's per-upload tip, in MIST. Mainnet prices the tip
 * linearly in encoded blob size, so a fixed cap is the only thing standing
 * between a large upload and an unbounded charge; `@mysten/walrus` refuses the
 * upload rather than exceeding it.
 */
export const DEFAULT_MAX_TIP_MIST = 10_000_000;

export interface GlobalOptions {
	readonly network?: string;
	readonly profile?: string;
	readonly rpc?: string;
	readonly uploadRelay?: string;
	readonly maxTip?: string;
	readonly json?: boolean;
	readonly quiet?: boolean;
	readonly yes?: boolean;
	readonly debug?: boolean;
}

export function buildProgram(): Command {
	const program = new Command();
	program
		.name("morse")
		.description(
			"Command-line interface for the Morse decentralized CMS on Sui.",
		)
		.version(pkg.version, "-V, --version", "Print the version and exit")
		.option(
			"--network <network>",
			"Sui network: mainnet, testnet, or localnet [env: MORSE_NETWORK]",
		)
		.option(
			"-p, --profile <name>",
			"Config profile to use [env: MORSE_PROFILE]",
		)
		.option("--rpc <url>", "Override the Sui RPC URL [env: MORSE_RPC_URL]")
		.option(
			"--upload-relay <url|auto>",
			"Upload Walrus blobs through a relay instead of fanning out to every storage node; 'auto' picks the canonical relay for the network. Costs a tip per upload [env: MORSE_WALRUS_UPLOAD_RELAY]",
		)
		.option(
			"--max-tip <mist>",
			`Cap the per-upload relay tip, in MIST (default: ${DEFAULT_MAX_TIP_MIST}) [env: MORSE_WALRUS_MAX_TIP]`,
		)
		.option("--json", "Output machine-readable JSON on stdout")
		.option("-q, --quiet", "Suppress progress and informational output")
		.option("-y, --yes", "Assume yes for confirmation prompts")
		.option("--debug", "Print stack traces on error")
		// Global options are recognized before the subcommand, local options after.
		// This lets a subcommand reuse a global flag name (e.g. `config add
		// --network`) without colliding with the global `--network`.
		.enablePositionalOptions()
		.showHelpAfterError()
		.exitOverride();
	return program;
}
