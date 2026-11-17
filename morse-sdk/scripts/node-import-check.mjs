/**
 * Import the built package on the Node that runs this file and check that the
 * entry point loads and works. CI runs it on the oldest Node line that
 * `engines.node` admits and on the Node used for development, so the
 * `engines` claim is tested and not only stated.
 *
 * The import names the package, not `dist/index.js`, so Node resolves it
 * through the `exports` map as it does for a consumer. Run `bun run build`
 * first: `dist/` is what gets imported.
 */

import assert from "node:assert/strict";

import * as sdk from "@arcadiasystems/morse-sdk";
import pkg from "../package.json" with { type: "json" };

assert.equal(typeof process.versions.bun, "undefined", "run this with node");

const config = sdk.morseConfig({ network: "testnet" });
assert.equal(config.network, "testnet");
assert.match(config.packageId, /^0x[0-9a-f]{64}$/);
assert.equal(
	sdk.TESTED_SUBSTRATE["@mysten/sui"],
	pkg.devDependencies["@mysten/sui"],
);

console.log(
	`${pkg.name}@${pkg.version} imports on Node ${process.versions.node} (engines.node: ${pkg.engines.node}).`,
);
