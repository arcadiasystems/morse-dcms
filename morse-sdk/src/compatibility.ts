/**
 * The Mysten substrate versions morse-sdk has been tested end-to-end
 * against. Compatibility is enforced at install time via peer-dependency
 * ranges in `package.json` (`bun install` warns if mismatched). Runtime
 * version checks are not provided because the Mysten libraries do not
 * expose their `package.json` `version` through their `exports` maps; a
 * hand-rolled "open the package.json from disk" check would be fragile in
 * browser bundlers and silent on misconfiguration.
 *
 * This constant is exported so consumers can display the tested matrix in
 * their own diagnostics, log it during initialization, or compare it
 * against bundler-resolved versions in CI.
 */

/** Mysten substrate library versions verified end-to-end on testnet. */
export const TESTED_SUBSTRATE: {
	readonly "@mysten/sui": string;
	readonly "@mysten/seal": string;
	readonly "@mysten/walrus": string;
	readonly verifiedOn: string;
	readonly suiNetwork: "testnet";
} = {
	"@mysten/sui": "2.16.2",
	"@mysten/seal": "1.1.3",
	"@mysten/walrus": "1.1.6",
	verifiedOn: "2026-05-10",
	suiNetwork: "testnet",
};
