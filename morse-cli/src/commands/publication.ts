/** `morse publication`: create, read, transfer, and delete publications. */

import {
	createPublication,
	deletePublication,
	toSuiAddress,
	transferOwnership,
} from "@arcadiasystems/morse-sdk";
import type { Command } from "commander";

import {
	buildReadContext,
	buildWriteContext,
	type ReadContext,
	type WriteContext,
} from "../cli/context.ts";
import { cancelled, UsageError } from "../cli/errors.ts";
import type { GlobalOptions } from "../cli/program.ts";
import { confirm } from "../cli/prompts.ts";
import { globalOptions } from "../cli/runtime.ts";
import { resolvePublication } from "../cli/target.ts";
import { updateActiveProfile } from "../config/active.ts";
import { shortId } from "../format/ids.ts";
import {
	type EnrichedPublication,
	renderEnrichedPublicationList,
	renderPublication,
	renderPublicationList,
} from "../format/render.ts";
import { ownerCapOption, publicationOption } from "./options.ts";
import { resolveOwnerCap } from "./resolve.ts";
import { parseLimit } from "./shared.ts";

interface ListOptions {
	readonly limit?: string;
	readonly cursor?: string;
	readonly idsOnly?: boolean;
}

export async function runPublicationGet(
	ctx: ReadContext,
	target: string | undefined,
): Promise<void> {
	const id = await resolvePublication(ctx, target);
	const result = await ctx.reader.getPublication(id, ctx.signal);
	ctx.output.result(renderPublication(result), result);
}

export async function runPublicationList(
	ctx: ReadContext,
	address: string | undefined,
	options: ListOptions,
): Promise<void> {
	const owner =
		address === undefined ? ctx.ownerAddress : toSuiAddress(address);
	if (owner === undefined) {
		throw new UsageError(
			"No address given and no active account. Pass an address or import an account.",
		);
	}
	const page = await ctx.reader.listPublicationsOwnedBy(owner, {
		signal: ctx.signal,
		...(options.limit === undefined
			? {}
			: { limit: parseLimit(options.limit) }),
		...(options.cursor === undefined ? {} : { cursor: options.cursor }),
	});
	if (page.nextCursor !== null) {
		ctx.output.info(`More results: pass --cursor "${page.nextCursor}"`);
	}
	if (options.idsOnly) {
		ctx.output.result(renderPublicationList(page.results), {
			results: page.results,
			nextCursor: page.nextCursor,
		});
		return;
	}
	// Enrich each row with its slug and name; the list RPC returns only ids, so
	// this costs one getPublication per result.
	const enriched: EnrichedPublication[] = [];
	for (const owned of page.results) {
		const pub = await ctx.reader.getPublication(
			owned.publicationId,
			ctx.signal,
		);
		enriched.push({
			slug: pub.slug,
			name: pub.name,
			publicationId: owned.publicationId,
			ownerCapId: owned.ownerCapId,
		});
	}
	ctx.output.result(renderEnrichedPublicationList(enriched), {
		results: enriched,
		nextCursor: page.nextCursor,
	});
}

export async function runPublicationCreate(
	ctx: WriteContext,
	options: { name: string; slug: string },
	gopts: GlobalOptions,
): Promise<void> {
	ctx.output.info(`Creating "${options.name}"...`);
	const result = await createPublication(ctx.adapter, ctx.config, {
		name: options.name,
		slug: options.slug,
		signal: ctx.signal,
	});
	// Select the new publication so follow-up commands need no id.
	await updateActiveProfile(gopts, {
		publication: result.publicationId,
		collection: undefined,
	});
	const human = [
		`Created "${options.name}" (${result.publicationId})`,
		`  ownerCap:     ${result.ownerCapId}`,
		`  publisherCap: ${result.publisherCapId}`,
		`  tx:           ${result.digest}`,
		"Selected as the active publication.",
	].join("\n");
	ctx.output.result(human, result);
}

export async function runPublicationDelete(
	ctx: WriteContext,
	target: string | undefined,
	options: { ownerCap?: string },
	gopts: GlobalOptions,
): Promise<void> {
	const id = await resolvePublication(ctx, target);
	const proceed = await confirm(
		`Delete publication ${shortId(id)}? This cannot be undone.`,
		{ assumeYes: Boolean(gopts.yes), signal: ctx.signal },
	);
	if (!proceed) {
		cancelled();
	}
	ctx.output.info("Resolving OwnerCap...");
	const ownerCapId = await resolveOwnerCap(
		ctx.reader,
		ctx.address,
		id,
		options.ownerCap,
		ctx.signal,
	);
	ctx.output.info("Deleting...");
	const result = await deletePublication(ctx.reader, ctx.adapter, ctx.config, {
		publicationId: id,
		ownerCapId,
		signal: ctx.signal,
	});
	if (ctx.settings.publication === id) {
		await updateActiveProfile(gopts, {
			publication: undefined,
			collection: undefined,
		});
	}
	ctx.output.result(`Deleted ${id}. (tx: ${result.digest})`, result);
}

export async function runPublicationTransferOwnership(
	ctx: WriteContext,
	recipient: string,
	options: { ownerCap?: string; publication?: string },
	gopts: GlobalOptions,
): Promise<void> {
	const id = await resolvePublication(ctx, options.publication);
	const to = toSuiAddress(recipient);
	const proceed = await confirm(
		`Transfer ownership of ${shortId(id)} to ${to}? You will lose owner control.`,
		{ assumeYes: Boolean(gopts.yes), signal: ctx.signal },
	);
	if (!proceed) {
		cancelled();
	}
	ctx.output.info("Resolving OwnerCap...");
	const ownerCapId = await resolveOwnerCap(
		ctx.reader,
		ctx.address,
		id,
		options.ownerCap,
		ctx.signal,
	);
	const result = await transferOwnership(ctx.adapter, ctx.config, {
		ownerCapId,
		recipient: to,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Transferred ownership of ${id} to ${to}. (tx: ${result.digest})`,
		result,
	);
}

export function registerPublicationCommands(program: Command): void {
	const publication = program
		.command("publication")
		.alias("pub")
		.description("Work with publications");

	publication
		.command("get [publication]")
		.description(
			"Fetch a publication (slug or id; default: the active publication)",
		)
		.action(async (target: string | undefined, _options, command: Command) => {
			await runPublicationGet(await buildReadContext(command), target);
		});

	publication
		.command("list [address]")
		.description(
			"List publications owned by an address (default: the active account)",
		)
		.option("--limit <n>", "Maximum results per page")
		.option("--cursor <cursor>", "Continue from a previous page cursor")
		.option(
			"--ids-only",
			"Skip slug/name resolution (one RPC, no per-publication reads)",
		)
		.action(
			async (
				address: string | undefined,
				options: ListOptions,
				command: Command,
			) => {
				await runPublicationList(
					await buildReadContext(command),
					address,
					options,
				);
			},
		);

	publication
		.command("create")
		.description("Create a publication and select it as the active publication")
		.requiredOption("-n, --name <name>", "Publication name")
		.requiredOption(
			"-s, --slug <slug>",
			"URL slug: lowercase alphanumeric and hyphens, 1-64 chars",
		)
		.action(
			async (options: { name: string; slug: string }, command: Command) => {
				await runPublicationCreate(
					await buildWriteContext(command),
					options,
					globalOptions(command),
				);
			},
		);

	publication
		.command("delete [publication]")
		.description(
			"Delete an empty publication (default: the active publication)",
		)
		.option("--owner-cap <id>", "OwnerCap ID (auto-resolved if omitted)")
		.action(
			async (
				target: string | undefined,
				options: { ownerCap?: string },
				command: Command,
			) => {
				await runPublicationDelete(
					await buildWriteContext(command),
					target,
					options,
					globalOptions(command),
				);
			},
		);

	const transfer = publication
		.command("transfer-ownership <recipient>")
		.description("Transfer a publication's OwnerCap to another address");
	publicationOption(ownerCapOption(transfer)).action(
		async (
			recipient: string,
			options: { ownerCap?: string; publication?: string },
			command: Command,
		) => {
			await runPublicationTransferOwnership(
				await buildWriteContext(command),
				recipient,
				options,
				globalOptions(command),
			);
		},
	);
}
