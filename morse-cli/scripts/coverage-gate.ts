#!/usr/bin/env bun
/**
 * Enforce the coverage floor. Bun reads bunfig's coverage settings (which scope
 * the report to src/) but does not fail the process on a threshold miss, so this
 * runs `bun test --coverage`, parses the summary, and exits non-zero when the
 * function or line percentage falls below the floor. Dev-only; runs under Bun.
 */

// Set ~1 point below the current measurement (96% function / 95% line) so
// routine edits do not flake the gate; raise these as coverage improves.
const FUNCTION_FLOOR = 95;
const LINE_FLOOR = 93;

const proc = Bun.spawn(["bun", "test", "--coverage"], {
	stdout: "pipe",
	stderr: "pipe",
});
const [stdout, stderr, code] = await Promise.all([
	new Response(proc.stdout).text(),
	new Response(proc.stderr).text(),
	proc.exited,
]);
const combined = `${stdout}\n${stderr}`;

if (code !== 0) {
	process.stderr.write(combined);
	process.stderr.write("\nTests failed; coverage gate aborted.\n");
	process.exit(code ?? 1);
}

const summary = combined.match(
	/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/,
);
if (summary === null) {
	process.stderr.write("Could not find the coverage summary in test output.\n");
	process.exit(1);
}

const functions = Number(summary[1]);
const lines = Number(summary[2]);
process.stdout.write(
	`Coverage: ${functions.toFixed(2)}% functions, ${lines.toFixed(2)}% lines ` +
		`(floor ${FUNCTION_FLOOR}% / ${LINE_FLOOR}%).\n`,
);

if (functions < FUNCTION_FLOOR || lines < LINE_FLOOR) {
	process.stderr.write("Coverage is below the floor.\n");
	process.exit(1);
}
process.stdout.write("Coverage gate passed.\n");
