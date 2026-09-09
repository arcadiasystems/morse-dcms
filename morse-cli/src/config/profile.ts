/**
 * Resolve effective settings from the precedence chain
 * `flags > MORSE_* env > config file > defaults`.
 */

import type { Network } from "@arcadiasystems/morse-sdk";

import { UsageError } from "../cli/errors.ts";
import { DEFAULT_MAX_TIP_MIST, type GlobalOptions } from "../cli/program.ts";
import { type Config, coerceNetwork } from "./schema.ts";

export interface ResolvedSettings {
	readonly profileName: string;
	readonly network: Network;
	readonly rpcUrl?: string;
	/**
	 * Raw upload-relay setting ("auto" or a URL), unresolved. Interpreted by
	 * the Walrus write path only; see `resolveUploadRelay`.
	 */
	readonly uploadRelay?: string;
	/** Raw tip ceiling in MIST, unparsed. See `parseMaxTip`. */
	readonly maxTip?: string;
	readonly account?: string;
	readonly publication?: string;
	readonly collection?: string;
}

type Env = Record<string, string | undefined>;

/** Canonical Mysten-run upload relay for a network, used by `--upload-relay auto`. */
function canonicalUploadRelay(network: Network): string | undefined {
	if (network === "mainnet" || network === "testnet") {
		return `https://upload-relay.${network}.walrus.space`;
	}
	return undefined;
}

/** Resolve "auto" to the network's canonical relay; pass any other value through. */
export function resolveUploadRelay(
	value: string | undefined,
	network: Network,
): string | undefined {
	if (value === undefined || value === "") {
		return undefined;
	}
	if (value !== "auto") {
		return value;
	}
	const canonical = canonicalUploadRelay(network);
	if (canonical === undefined) {
		throw new UsageError(
			`--upload-relay auto has no canonical relay for ${network}. Pass an explicit relay URL.`,
		);
	}
	return canonical;
}

/** Parse the tip ceiling, rejecting anything that is not a non-negative integer. */
export function parseMaxTip(value: string | undefined): number {
	if (value === undefined || value === "") {
		return DEFAULT_MAX_TIP_MIST;
	}
	// Plain digits only: Number() would also accept "1e7" and "0x10", which are
	// not how anyone means to write a MIST amount.
	const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
	if (!Number.isSafeInteger(parsed)) {
		throw new UsageError(
			`--max-tip must be a non-negative integer in MIST; got "${value}".`,
		);
	}
	return parsed;
}

export function resolveSettings(
	opts: Pick<
		GlobalOptions,
		"profile" | "network" | "rpc" | "uploadRelay" | "maxTip"
	>,
	config: Config,
	env: Env = process.env,
): ResolvedSettings {
	const explicitProfile = opts.profile ?? env.MORSE_PROFILE;
	const profileName = explicitProfile ?? config.defaultProfile;
	const profile = config.profiles[profileName];
	// A profile named explicitly via flag or env must exist; falling back to the
	// stored default on a fresh install is fine and resolves to bare defaults.
	if (explicitProfile !== undefined && profile === undefined) {
		throw new UsageError(
			`No profile named "${profileName}". Create it with: morse config add ${profileName} --network testnet`,
		);
	}
	const networkValue =
		opts.network ?? env.MORSE_NETWORK ?? profile?.network ?? "testnet";
	const network = coerceNetwork(networkValue);
	const rpcUrl = opts.rpc ?? env.MORSE_RPC_URL ?? profile?.rpc;
	// Deliberately not validated here: resolveSettings runs for every command,
	// including reads that never upload. Parsing eagerly would let a typo'd
	// MORSE_WALRUS_MAX_TIP in a shell profile or CI env break `publication get`.
	const uploadRelay =
		opts.uploadRelay ?? env.MORSE_WALRUS_UPLOAD_RELAY ?? profile?.uploadRelay;
	const maxTip = opts.maxTip ?? env.MORSE_WALRUS_MAX_TIP;
	const account = env.MORSE_ADDRESS ?? profile?.account;
	const publication = env.MORSE_PUBLICATION ?? profile?.publication;
	const collection = env.MORSE_COLLECTION ?? profile?.collection;
	return {
		profileName,
		network,
		rpcUrl,
		uploadRelay,
		maxTip,
		account,
		publication,
		collection,
	};
}
