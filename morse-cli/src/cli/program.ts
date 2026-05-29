/** Root command assembly: name, version, and the global options every command shares. */

import { Command } from "commander";

import pkg from "../../package.json" with { type: "json" };

/** Options defined on the root command, available to every subcommand. */
export interface GlobalOptions {
	readonly network?: string;
	readonly profile?: string;
	readonly rpc?: string;
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
			"Sui network: testnet or localnet [env: MORSE_NETWORK]",
		)
		.option(
			"-p, --profile <name>",
			"Config profile to use [env: MORSE_PROFILE]",
		)
		.option("--rpc <url>", "Override the Sui RPC URL [env: MORSE_RPC_URL]")
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
