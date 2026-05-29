/** Filesystem locations for CLI state, resolved via XDG with a home fallback. */

import { homedir } from "node:os";
import { join } from "node:path";

/** Base config directory: `$XDG_CONFIG_HOME/morse` or `~/.config/morse`. */
export function configDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
	return join(base, "morse");
}

export function configFilePath(): string {
	return join(configDir(), "config.json");
}

/** Directory holding per-address encrypted keystore files. */
export function keystoreDir(): string {
	return join(configDir(), "keystores");
}
