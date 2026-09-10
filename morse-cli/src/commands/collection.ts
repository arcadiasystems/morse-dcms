/** `morse collection`: create, list, and delete collections within a publication. */

import {
	createCollection,
	deleteCollection,
	StorageMode,
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
import { renderCollectionList } from "../format/render.ts";
import {
	publicationOption,
	publisherCapOption,
	type TargetOptions,
} from "./options.ts";
import { resolvePublisherCap } from "./resolve.ts";
import { coerceStorageMode } from "./shared.ts";

type CreateOptions = TargetOptions & { mode: string; publisherCap?: string };
type DeleteOptions = TargetOptions & { publisherCap?: string };

export async function runCollectionList(
	ctx: ReadContext,
	options: TargetOptions,
): Promise<void> {
	const id = await resolvePublication(ctx, options.publication);
	const publication = await ctx.reader.getPublication(id, ctx.signal);
	ctx.output.result(renderCollectionList(publication.collections), {
		publication: id,
		collections: publication.collections,
	});
}

/**
 * Whether `target` is the publication the profile currently has active.
 * Collection names are per-publication, so active-collection state is only
 * meaningful when the two agree.
 */
function isActivePublication(
	ctx: { settings: { publication?: string } },
	target: string,
): boolean {
	return ctx.settings.publication === target;
}

export async function runCollectionCreate(
	ctx: WriteContext,
	name: string,
	options: CreateOptions,
	gopts: GlobalOptions,
): Promise<void> {
	const id = await resolvePublication(ctx, options.publication);
	const storageMode = coerceStorageMode(options.mode);
	const publisherCapId = await resolvePublisherCap(
		ctx.reader,
		ctx.address,
		id,
		options.publisherCap,
		ctx.signal,
	);
	if (storageMode === StorageMode.Quilt) {
		ctx.output.warn(
			"Quilt collections cannot yet be populated with `morse entry add` (only blob collections are supported).",
		);
	}
	ctx.output.info(`Creating collection "${name}" (${storageMode})...`);
	const result = await createCollection(ctx.adapter, ctx.config, {
		publicationId: id,
		publisherCapId,
		name,
		storageMode,
		signal: ctx.signal,
	});
	// Select it so follow-up entry commands need no -C, but only when it was
	// created under the active publication. Collection names are scoped per
	// publication, so selecting one created under an explicit -P elsewhere
	// would pair the active publication with a collection it does not contain.
	const selected = isActivePublication(ctx, id);
	if (selected) {
		await updateActiveProfile(gopts, { collection: name });
	}
	ctx.output.result(
		`Created collection "${name}".${selected ? " Selected as the active collection." : ""} (tx: ${result.digest})`,
		result,
	);
}

export async function runCollectionDelete(
	ctx: WriteContext,
	name: string,
	options: DeleteOptions,
	gopts: GlobalOptions,
): Promise<void> {
	const id = await resolvePublication(ctx, options.publication);
	// Check emptiness before prompting or submitting; the contract aborts on a
	// non-empty collection, but that surfaces as a raw transaction error.
	const entries = await ctx.reader.listEntries(id, name, {
		limit: 1,
		signal: ctx.signal,
	});
	if (entries.results.length > 0) {
		throw new UsageError(
			`Cannot delete collection "${name}": it still has entries. Delete them first.`,
		);
	}
	const proceed = await confirm(
		`Delete collection "${name}" from ${shortId(id)}? It must be empty.`,
		{ assumeYes: Boolean(gopts.yes), signal: ctx.signal },
	);
	if (!proceed) {
		cancelled();
	}
	const publisherCapId = await resolvePublisherCap(
		ctx.reader,
		ctx.address,
		id,
		options.publisherCap,
		ctx.signal,
	);
	const result = await deleteCollection(ctx.adapter, ctx.config, {
		publicationId: id,
		publisherCapId,
		name,
		signal: ctx.signal,
	});
	// Same scoping as create: only clear the active collection when the one we
	// deleted is actually that one, publication included. Matching on name
	// alone cleared a still-valid selection belonging to another publication.
	if (ctx.settings.collection === name && isActivePublication(ctx, id)) {
		await updateActiveProfile(gopts, { collection: undefined });
	}
	ctx.output.result(
		`Deleted collection "${name}". (tx: ${result.digest})`,
		result,
	);
}

export function registerCollectionCommands(program: Command): void {
	const collection = program
		.command("collection")
		.description("Manage collections within a publication");

	const list = collection
		.command("list")
		.description("List the collections in a publication");
	publicationOption(list).action(
		async (options: TargetOptions, command: Command) => {
			await runCollectionList(await buildReadContext(command), options);
		},
	);

	const create = collection
		.command("create <name>")
		.description("Create a collection and select it as the active collection")
		.option("--mode <mode>", "Storage mode: blob or quilt", "blob");
	publicationOption(publisherCapOption(create)).action(
		async (name: string, options: CreateOptions, command: Command) => {
			await runCollectionCreate(
				await buildWriteContext(command),
				name,
				options,
				globalOptions(command),
			);
		},
	);

	const remove = collection
		.command("delete <name>")
		.description("Delete an empty collection");
	publicationOption(publisherCapOption(remove)).action(
		async (name: string, options: DeleteOptions, command: Command) => {
			await runCollectionDelete(
				await buildWriteContext(command),
				name,
				options,
				globalOptions(command),
			);
		},
	);
}
