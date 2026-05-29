/** Merge active-context fields (account, publication, collection) into a profile. */

import type { GlobalOptions } from "../cli/program.ts";
import { coerceNetwork, type Profile } from "./schema.ts";
import { loadConfig, saveConfig } from "./store.ts";

export type ProfilePatch = Partial<
	Pick<Profile, "account" | "publication" | "collection">
>;

type Env = Record<string, string | undefined>;

/**
 * Apply a patch to the resolved profile, creating it (and making it the default)
 * when the resolved name does not exist yet. A field set to `undefined` in the
 * patch is cleared. Returns the profile name written.
 */
export async function updateActiveProfile(
	opts: Pick<GlobalOptions, "profile" | "network">,
	patch: ProfilePatch,
	env: Env = process.env,
): Promise<string> {
	const config = await loadConfig();
	const profileName =
		opts.profile ?? env.MORSE_PROFILE ?? config.defaultProfile;
	const existing = config.profiles[profileName];
	const network = coerceNetwork(
		opts.network ?? env.MORSE_NETWORK ?? existing?.network ?? "testnet",
	);
	const merged: Profile = { ...existing, network, ...patch };
	const profiles = { ...config.profiles, [profileName]: merged };
	const defaultProfile =
		Object.keys(config.profiles).length === 0
			? profileName
			: config.defaultProfile;
	await saveConfig({ ...config, profiles, defaultProfile });
	return profileName;
}
