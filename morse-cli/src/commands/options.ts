/** Reusable commander option groups for target context and content input. */

import type { Command } from "commander";

export function publicationOption(command: Command): Command {
	return command.option(
		"-P, --publication <slug|id>",
		"Publication slug or id (default: the active publication)",
	);
}

export function collectionOption(command: Command): Command {
	return command.option(
		"-C, --collection <name>",
		"Collection name (default: the active collection)",
	);
}

export function publisherCapOption(command: Command): Command {
	return command.option(
		"--publisher-cap <id>",
		"PublisherCap ID (auto-resolved if omitted)",
	);
}

export function ownerCapOption(command: Command): Command {
	return command.option(
		"--owner-cap <id>",
		"OwnerCap ID (auto-resolved if omitted)",
	);
}

function collect(value: string, previous: string[]): string[] {
	return [...previous, value];
}

export function recipientOption(command: Command): Command {
	return command.option(
		"-r, --recipient <addr>",
		"Recipient address allowed to decrypt (repeatable); the sender is always added",
		collect,
		[],
	);
}

export function viaAggregatorOption(command: Command): Command {
	return command.option(
		"--via-aggregator",
		"Fetch content via the Walrus aggregator HTTP service. More reliable when storage nodes are flaky; no client-side blob verification.",
	);
}

export function contentOptions(command: Command): Command {
	return command
		.option("-f, --file <path>", "File to upload (or - for stdin)")
		.option("--stdin", "Read content from stdin")
		.option(
			"--content-type <type>",
			"MIME content type (inferred from --file if omitted)",
		)
		.option("--epochs <n>", "Walrus storage epochs", "3");
}

/** Shared option shapes the action callbacks read. */
export interface TargetOptions {
	readonly publication?: string;
	readonly collection?: string;
}

export interface ContentOptions extends TargetOptions {
	readonly file?: string;
	readonly stdin?: boolean;
	readonly contentType?: string;
	readonly epochs: string;
	readonly publisherCap?: string;
}
