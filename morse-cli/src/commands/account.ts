/** `morse account`: import and manage encrypted signing keys. */

import type { Command } from "commander";

import { cancelled, UsageError } from "../cli/errors.ts";
import type { Output } from "../cli/output.ts";
import type { GlobalOptions } from "../cli/program.ts";
import {
	confirm,
	isInteractive,
	promptHidden,
	sigintSignal,
} from "../cli/prompts.ts";
import { globalOptions, outputFor } from "../cli/runtime.ts";
import { updateActiveProfile } from "../config/active.ts";
import { resolveSettings } from "../config/profile.ts";
import { loadConfig } from "../config/store.ts";
import {
	hasKeystore,
	importKey,
	listAddresses,
	unlockSecret,
} from "../keystore/keystore.ts";
import { accountAddress } from "../keystore/source.ts";
import { resolvePassword } from "../keystore/unlock.ts";

export type Env = Record<string, string | undefined>;

export async function runAccountImport(
	output: Output,
	gopts: GlobalOptions,
	env: Env,
	signal: AbortSignal,
): Promise<void> {
	const secret = await readSecretToImport(env, signal);
	const password = await resolvePassword("create", env, signal);
	const address = await importKey(secret, password);
	const profileName = await associateAccount(gopts, address);
	output.info(`Imported ${address} into keystore.`);
	output.result(`Imported account ${address} (profile "${profileName}").`, {
		address,
		profile: profileName,
	});
}

export async function runAccountList(
	output: Output,
	gopts: GlobalOptions,
): Promise<void> {
	const addresses = await listAddresses();
	const active = await resolveActiveAccount(gopts);
	if (addresses.length === 0) {
		output.result("No accounts. Import one with: morse account import", {
			active,
			accounts: [],
		});
		return;
	}
	const human = addresses
		.map((address) => `${address === active ? "*" : " "} ${address}`)
		.join("\n");
	output.result(human, { active, accounts: addresses });
}

export async function runAccountShow(
	output: Output,
	gopts: GlobalOptions,
): Promise<void> {
	const active = await resolveActiveAccount(gopts);
	if (active === undefined) {
		throw new UsageError(
			"No active account. Import one with `morse account import` or set MORSE_ADDRESS.",
		);
	}
	output.result(active, { address: active });
}

export async function runAccountUse(
	output: Output,
	gopts: GlobalOptions,
	address: string,
): Promise<void> {
	if (!(await hasKeystore(address))) {
		throw new UsageError(
			`No keystore for ${address}. Import it first with: morse account import`,
		);
	}
	const profileName = await associateAccount(gopts, address);
	output.result(`Active account for "${profileName}" set to ${address}.`, {
		address,
		profile: profileName,
	});
}

export async function runAccountExport(
	output: Output,
	gopts: GlobalOptions,
	address: string,
	env: Env,
	signal: AbortSignal,
): Promise<void> {
	if (output.isJson) {
		throw new UsageError("account export is not available in --json mode.");
	}
	if (!isInteractive()) {
		throw new UsageError("account export requires an interactive terminal.");
	}
	// Revealing a private key is never something --yes should wave through.
	if (gopts.yes) {
		throw new UsageError(
			"account export does not accept --yes. Confirm interactively.",
		);
	}
	const proceed = await confirm(
		`Reveal the secret key for ${address}? Anyone who sees it controls the account.`,
		{ signal },
	);
	if (!proceed) {
		cancelled();
	}
	const password = await resolvePassword("unlock", env, signal);
	const secret = await unlockSecret(address, password);
	// Write the warning directly to stderr so --quiet cannot suppress the only
	// cue that a secret follows on stdout.
	process.stderr.write("Warning: secret key follows. Handle it with care.\n");
	process.stdout.write(`${secret}\n`);
}

export function registerAccountCommands(program: Command): void {
	const account = program
		.command("account")
		.description("Import and manage encrypted signing keys");

	account
		.command("import")
		.description("Import a private key into an encrypted keystore")
		.action(async (_options, command: Command) => {
			await runAccountImport(
				outputFor(command),
				globalOptions(command),
				process.env,
				sigintSignal(),
			);
		});

	account
		.command("list")
		.description("List imported accounts")
		.action(async (_options, command: Command) => {
			await runAccountList(outputFor(command), globalOptions(command));
		});

	account
		.command("show")
		.description("Print the active account address")
		.action(async (_options, command: Command) => {
			await runAccountShow(outputFor(command), globalOptions(command));
		});

	account
		.command("use <address>")
		.description("Set the active account for the current profile")
		.action(async (address: string, _options, command: Command) => {
			await runAccountUse(outputFor(command), globalOptions(command), address);
		});

	account
		.command("export <address>")
		.description("Print a decrypted secret key (dangerous)")
		.action(async (address: string, _options, command: Command) => {
			await runAccountExport(
				outputFor(command),
				globalOptions(command),
				address,
				process.env,
				sigintSignal(),
			);
		});
}

async function readSecretToImport(
	env: Env,
	signal?: AbortSignal,
): Promise<string> {
	const raw = env.MORSE_PRIVATE_KEY;
	if (raw !== undefined && raw.length > 0) {
		return raw;
	}
	if (!isInteractive()) {
		throw new UsageError(
			"Cannot read a private key: set MORSE_PRIVATE_KEY or run in an interactive terminal.",
		);
	}
	process.stderr.write(
		"Paste your Sui private key (starts with suiprivkey1...), then press Enter. Input is hidden.\n",
	);
	const secret = await promptHidden("Private key (hidden): ", signal);
	if (secret.length === 0) {
		throw new UsageError("No private key entered.");
	}
	return secret;
}

/**
 * Point the resolved profile at `address`, creating the profile when the
 * resolved name does not exist yet (so a first-run import is usable immediately).
 */
async function associateAccount(
	gopts: GlobalOptions,
	address: string,
): Promise<string> {
	return updateActiveProfile(gopts, { account: address });
}

async function resolveActiveAccount(
	gopts: GlobalOptions,
): Promise<string | undefined> {
	return accountAddress(resolveSettings(gopts, await loadConfig()).account);
}
