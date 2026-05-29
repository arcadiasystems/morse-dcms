/** Register every command group on the root program. */

import type { Command } from "commander";

import { registerAccountCommands } from "./account.ts";
import { registerCapCommands } from "./cap.ts";
import { registerCollectionCommands } from "./collection.ts";
import { registerConfigCommands } from "./config.ts";
import { registerEntryCommands } from "./entry.ts";
import { registerPublicationCommands } from "./publication.ts";
import { registerRevisionCommands } from "./revision.ts";
import { registerContextCommands } from "./use.ts";

export function registerCommands(program: Command): void {
	registerConfigCommands(program);
	registerAccountCommands(program);
	registerContextCommands(program);
	registerPublicationCommands(program);
	registerCollectionCommands(program);
	registerEntryCommands(program);
	registerRevisionCommands(program);
	registerCapCommands(program);
}
