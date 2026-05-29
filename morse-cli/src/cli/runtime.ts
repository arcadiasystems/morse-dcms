/** Helpers shared by command actions: pull global options and build an Output. */

import type { Command } from "commander";

import { createOutput, type Output } from "./output.ts";
import type { GlobalOptions } from "./program.ts";

export function globalOptions(command: Command): GlobalOptions {
	return command.optsWithGlobals<GlobalOptions>();
}

export function outputFor(command: Command): Output {
	return createOutput(globalOptions(command));
}
