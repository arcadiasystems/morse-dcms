/** Config file shape and boundary validation. */

import { Network } from "@arcadiasystems/morse-sdk";

import { CliError, UsageError } from "../cli/errors.ts";
import { ExitCode } from "../cli/exit-codes.ts";

export const CONFIG_VERSION = 1;

/**
 * A named target: which network, optional RPC override, optional active account
 * address, and the active publication (id) and collection (name) used as
 * defaults when a command omits them.
 */
export interface Profile {
	readonly network: Network;
	readonly rpc?: string;
	readonly account?: string;
	readonly publication?: string;
	readonly collection?: string;
}

export interface Config {
	readonly version: number;
	readonly defaultProfile: string;
	readonly profiles: Record<string, Profile>;
}

export function emptyConfig(): Config {
	return { version: CONFIG_VERSION, defaultProfile: "default", profiles: {} };
}

const NETWORKS: ReadonlySet<string> = new Set(Object.values(Network));

export function isNetwork(value: unknown): value is Network {
	return typeof value === "string" && NETWORKS.has(value);
}

/** Validate a network string from a flag or env var. Mainnet is not yet deployed. */
export function coerceNetwork(value: string): Network {
	if (value === Network.Mainnet) {
		throw new UsageError(
			"Morse is not yet deployed on mainnet. Use testnet or localnet.",
		);
	}
	if (isNetwork(value)) {
		return value;
	}
	throw new UsageError(
		`Unknown network "${value}". Use one of: testnet, localnet.`,
	);
}

/** Parse and validate the decoded config JSON, rejecting a malformed file. */
export function parseConfig(raw: unknown, source: string): Config {
	if (!isRecord(raw)) {
		throw malformed(source, "expected a JSON object");
	}
	const defaultProfile = raw.defaultProfile;
	if (typeof defaultProfile !== "string") {
		throw malformed(source, "defaultProfile must be a string");
	}
	const profilesRaw = raw.profiles;
	if (!isRecord(profilesRaw)) {
		throw malformed(source, "profiles must be an object");
	}
	const profiles: Record<string, Profile> = {};
	for (const [name, value] of Object.entries(profilesRaw)) {
		profiles[name] = parseProfile(name, value, source);
	}
	const version =
		typeof raw.version === "number" ? raw.version : CONFIG_VERSION;
	return { version, defaultProfile, profiles };
}

function parseProfile(name: string, value: unknown, source: string): Profile {
	if (!isRecord(value)) {
		throw malformed(source, `profile "${name}" must be an object`);
	}
	if (!isNetwork(value.network)) {
		throw malformed(source, `profile "${name}" has an invalid network`);
	}
	const profile: {
		network: Network;
		rpc?: string;
		account?: string;
		publication?: string;
		collection?: string;
	} = {
		network: value.network,
	};
	if (typeof value.rpc === "string") {
		profile.rpc = value.rpc;
	}
	if (typeof value.account === "string") {
		profile.account = value.account;
	}
	if (typeof value.publication === "string") {
		profile.publication = value.publication;
	}
	if (typeof value.collection === "string") {
		profile.collection = value.collection;
	}
	return profile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(source: string, detail: string): CliError {
	// A corrupt config file is not a command-usage error; it is a generic
	// failure the user fixes by editing or removing the file.
	return new CliError(
		`Config file at ${source} is malformed: ${detail}.`,
		ExitCode.Generic,
	);
}
