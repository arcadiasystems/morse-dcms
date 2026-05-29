#!/usr/bin/env bun

import { handleError } from "./cli/errors.ts";
import { buildProgram, type GlobalOptions } from "./cli/program.ts";
import { registerCommands } from "./commands/index.ts";

const program = buildProgram();
registerCommands(program);

// With subcommands defined, show help instead of exiting silently on bare `morse`.
if (process.argv.length <= 2) {
	program.outputHelp();
	process.exitCode = 0;
} else {
	try {
		await program.parseAsync();
	} catch (err) {
		const opts = program.opts<GlobalOptions>();
		process.exitCode = handleError(err, {
			json: Boolean(opts.json),
			debug: Boolean(opts.debug),
		});
	}
}
