/**
 * A capturing Output for in-process handler tests: records stdout/stderr writes
 * into buffers instead of the process streams, so a test can assert the exact
 * result string, the parsed --json document, and the stderr diagnostics.
 */

import { Output } from "../../src/cli/output.ts";

export interface CapturedOutput {
	readonly output: Output;
	stdout(): string;
	stderr(): string;
	/** Parse the stdout buffer as JSON (use with json: true). */
	json(): unknown;
}

export function captureOutput(
	opts: { json?: boolean; quiet?: boolean } = {},
): CapturedOutput {
	let out = "";
	let err = "";
	const output = new Output({
		json: Boolean(opts.json),
		quiet: Boolean(opts.quiet),
		color: false,
		writeOut: (text) => {
			out += text;
		},
		writeErr: (text) => {
			err += text;
		},
	});
	return {
		output,
		stdout: () => out,
		stderr: () => err,
		json: () => JSON.parse(out),
	};
}
