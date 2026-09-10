/**
 * Fail when the README or CHANGELOG has fallen behind `package.json`.
 *
 * The CLI's docs carry two facts that must track the version, and neither is
 * covered by lint, typecheck, tests or the coverage gate:
 *   1. The status banner names the current version. It is the first line a
 *      reader sees, and it silently claimed v0.3.0 for two whole releases.
 *   2. CHANGELOG's newest entry matches the package version, so a release
 *      cannot ship undocumented.
 *
 * Deliberately narrow. This is not a linter; it only knows facts that must
 * change whenever the version does.
 */

import pkg from "../package.json" with { type: "json" };

const readme = await Bun.file(new URL("../README.md", import.meta.url)).text();
const changelog = await Bun.file(
	new URL("../CHANGELOG.md", import.meta.url),
).text();

const failures: string[] = [];

if (!readme.includes(`Status: v${pkg.version}.`)) {
	const found = /Status: v([0-9.]+)/.exec(readme)?.[1] ?? "(none)";
	failures.push(
		`README status banner says v${found}, but package.json is ${pkg.version}.`,
	);
}

const newestEntry = /^## \[([0-9]+\.[0-9]+\.[0-9]+)\]/m.exec(changelog)?.[1];
if (newestEntry !== pkg.version) {
	failures.push(
		`CHANGELOG's newest entry is ${newestEntry ?? "(none)"}, but package.json is ${pkg.version}. Every release needs an entry.`,
	);
}

if (failures.length > 0) {
	console.error(`Docs gate failed for ${pkg.name}@${pkg.version}:`);
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
console.log(`Docs gate passed (${pkg.name}@${pkg.version}).`);
