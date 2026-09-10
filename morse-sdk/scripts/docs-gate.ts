/**
 * Fail when the README's documentation of this release has fallen behind
 * `package.json`. Cheap, and it catches the drift that keeps recurring.
 *
 * Two rules, both chosen because they broke twice in practice and neither is
 * covered by lint, typecheck or tests:
 *   1. The compatibility table has a row for the current minor. It is the
 *      table people read before pinning, so a missing row silently tells them
 *      the newest supported version is older than what they installed.
 *   2. The pin example names the current minor, for the same reason.
 *   3. CHANGELOG's newest entry matches the package version, so a release
 *      cannot ship undocumented.
 *
 * Not a linter: it only knows about facts that must track the version number.
 */

import pkg from "../package.json" with { type: "json" };

const readme = await Bun.file(new URL("../README.md", import.meta.url)).text();
const changelog = await Bun.file(
	new URL("../CHANGELOG.md", import.meta.url),
).text();

const version = pkg.version;
const [major, minor] = version.split(".");
const minorSeries = `${major}.${minor}.x`;
const pinSeries = `${major}.${minor}.0`;

const failures: string[] = [];

if (!new RegExp(`^\\|\\s*${major}\\.${minor}\\.x\\s*\\|`, "m").test(readme)) {
	failures.push(
		`README compatibility table has no row for ${minorSeries}. Add one (and its verified date) when bumping the minor.`,
	);
}

if (!readme.includes(`morse-sdk@~${pinSeries}`)) {
	failures.push(
		`README pin example does not name ~${pinSeries}. Update it so readers pin the current minor.`,
	);
}

const newestEntry = /^## \[([0-9]+\.[0-9]+\.[0-9]+)\]/m.exec(changelog)?.[1];
if (newestEntry !== version) {
	failures.push(
		`CHANGELOG's newest entry is ${newestEntry ?? "(none)"}, but package.json is ${version}. Every release needs an entry.`,
	);
}

if (failures.length > 0) {
	console.error(`Docs gate failed for ${pkg.name}@${version}:`);
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
console.log(`Docs gate passed (${pkg.name}@${version}).`);
