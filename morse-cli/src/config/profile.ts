/**
 * Resolve effective settings from the precedence chain
 * `flags > MORSE_* env > config file > defaults`.
 */

import type { Network } from "@arcadiasystems/morse-sdk";

import { UsageError } from "../cli/errors.ts";
import type { GlobalOptions } from "../cli/program.ts";
import { type Config, coerceNetwork } from "./schema.ts";

export interface ResolvedSettings {
	readonly profileName: string;
	readonly network: Network;
	readonly rpcUrl?: string;
	readonly account?: string;
	readonly publication?: string;
	readonly collection?: string;
}

type Env = Record<string, string | undefined>;

export function resolveSettings(
	opts: Pick<GlobalOptions, "profile" | "network" | "rpc">,
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
	const account = env.MORSE_ADDRESS ?? profile?.account;
	const publication = env.MORSE_PUBLICATION ?? profile?.publication;
	const collection = env.MORSE_COLLECTION ?? profile?.collection;
	return { profileName, network, rpcUrl, account, publication, collection };
}
