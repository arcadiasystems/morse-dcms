/** `morse config`: manage profiles and CLI configuration. */

import type { Command } from "commander";

import { UsageError } from "../cli/errors.ts";
import type { Output } from "../cli/output.ts";
import { outputFor } from "../cli/runtime.ts";
import { configFilePath } from "../config/paths.ts";
import { type Config, coerceNetwork } from "../config/schema.ts";
import { loadConfig, saveConfig } from "../config/store.ts";

export function runConfigPath(output: Output): void {
	const path = configFilePath();
	output.result(path, { path });
}

export async function runConfigList(output: Output): Promise<void> {
	const cfg = await loadConfig();
	output.result(renderProfiles(cfg), {
		defaultProfile: cfg.defaultProfile,
		profiles: cfg.profiles,
	});
}

export async function runConfigAdd(
	output: Output,
	name: string,
	options: { network: string; rpc?: string },
): Promise<void> {
	const network = coerceNetwork(options.network);
	const cfg = await loadConfig();
	const profiles = {
		...cfg.profiles,
		[name]: {
			network,
			...(options.rpc === undefined ? {} : { rpc: options.rpc }),
		},
	};
	// First profile on a fresh config becomes the default automatically.
	const defaultProfile =
		Object.keys(cfg.profiles).length === 0 ? name : cfg.defaultProfile;
	await saveConfig({ ...cfg, profiles, defaultProfile });
	output.result(`Saved profile "${name}" (${network}).`, {
		profile: name,
		network,
		rpc: options.rpc,
		default: defaultProfile === name,
	});
}

export async function runConfigUse(
	output: Output,
	name: string,
): Promise<void> {
	const cfg = await loadConfig();
	requireProfile(cfg, name);
	await saveConfig({ ...cfg, defaultProfile: name });
	output.result(`Default profile set to "${name}".`, { defaultProfile: name });
}

export async function runConfigRemove(
	output: Output,
	name: string,
): Promise<void> {
	const cfg = await loadConfig();
	requireProfile(cfg, name);
	const { [name]: _removed, ...rest } = cfg.profiles;
	const defaultProfile =
		cfg.defaultProfile === name
			? (Object.keys(rest)[0] ?? "default")
			: cfg.defaultProfile;
	await saveConfig({ ...cfg, profiles: rest, defaultProfile });
	output.result(`Removed profile "${name}".`, {
		removed: name,
		defaultProfile,
		profiles: Object.keys(rest),
	});
}

export function registerConfigCommands(program: Command): void {
	const config = program
		.command("config")
		.description("Manage profiles and CLI configuration");

	config
		.command("path")
		.description("Print the config file path")
		.action((_options, command: Command) => {
			runConfigPath(outputFor(command));
		});

	config
		.command("list")
		.description("List profiles and show the default")
		.action(async (_options, command: Command) => {
			await runConfigList(outputFor(command));
		});

	config
		.command("add <name>")
		.description("Create or update a profile")
		.requiredOption("--network <network>", "Sui network: testnet or localnet")
		.option("--rpc <url>", "RPC URL override for this profile")
		.action(
			async (
				name: string,
				options: { network: string; rpc?: string },
				command: Command,
			) => {
				await runConfigAdd(outputFor(command), name, options);
			},
		);

	config
		.command("use <name>")
		.description("Set the default profile")
		.action(async (name: string, _options, command: Command) => {
			await runConfigUse(outputFor(command), name);
		});

	config
		.command("remove <name>")
		.description("Delete a profile")
		.action(async (name: string, _options, command: Command) => {
			await runConfigRemove(outputFor(command), name);
		});
}

function requireProfile(config: Config, name: string): void {
	if (!(name in config.profiles)) {
		throw new UsageError(
			`No profile named "${name}". Create it with: morse config add ${name} --network testnet`,
		);
	}
}

function renderProfiles(config: Config): string {
	const names = Object.keys(config.profiles);
	if (names.length === 0) {
		return "No profiles configured. Add one with: morse config add <name> --network testnet";
	}
	return names
		.map((name) => {
			const profile = config.profiles[name];
			if (profile === undefined) {
				return name;
			}
			const marker = name === config.defaultProfile ? "*" : " ";
			const parts: string[] = [profile.network];
			if (profile.rpc !== undefined) {
				parts.push(profile.rpc);
			}
			if (profile.account !== undefined) {
				parts.push(profile.account);
			}
			return `${marker} ${name}  ${parts.join("  ")}`;
		})
		.join("\n");
}
