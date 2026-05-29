/** `morse collection`: create, list, and delete collections within a publication. */

import { createCollection, deleteCollection } from "@arcadiasystems/morse-sdk";
import type { Command } from "commander";

import { buildReadContext, buildWriteContext } from "../cli/context.ts";
import { cancelled } from "../cli/errors.ts";
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

export function registerCollectionCommands(program: Command): void {
	const collection = program
		.command("collection")
		.description("Manage collections within a publication");

	const list = collection
		.command("list")
		.description("List the collections in a publication");
	publicationOption(list).action(
		async (options: TargetOptions, command: Command) => {
			const ctx = await buildReadContext(command);
			const id = await resolvePublication(ctx, options.publication);
			const publication = await ctx.reader.getPublication(id, ctx.signal);
			ctx.output.result(renderCollectionList(publication.collections), {
				publication: id,
				collections: publication.collections,
			});
		},
	);

	const create = collection
		.command("create <name>")
		.description("Create a collection and select it as the active collection")
		.option("--mode <mode>", "Storage mode: blob or quilt", "blob");
	publicationOption(publisherCapOption(create)).action(
		async (
			name: string,
			options: TargetOptions & { mode: string; publisherCap?: string },
			command: Command,
		) => {
			const ctx = await buildWriteContext(command);
			const id = await resolvePublication(ctx, options.publication);
			const storageMode = coerceStorageMode(options.mode);
			const publisherCapId = await resolvePublisherCap(
				ctx.reader,
				ctx.address,
				id,
				options.publisherCap,
				ctx.signal,
			);
			ctx.output.info(`Creating collection "${name}" (${storageMode})...`);
			const result = await createCollection(ctx.adapter, ctx.config, {
				publicationId: id,
				publisherCapId,
				name,
				storageMode,
				signal: ctx.signal,
			});
			// Select the collection so follow-up entry commands need no -C.
			await updateActiveProfile(globalOptions(command), { collection: name });
			ctx.output.result(
				`Created collection "${name}". Selected as the active collection. (tx: ${result.digest})`,
				result,
			);
		},
	);

	const remove = collection
		.command("delete <name>")
		.description("Delete an empty collection");
	publicationOption(publisherCapOption(remove)).action(
		async (
			name: string,
			options: TargetOptions & { publisherCap?: string },
			command: Command,
		) => {
			const ctx = await buildWriteContext(command);
			const id = await resolvePublication(ctx, options.publication);
			const proceed = await confirm(
				`Delete collection "${name}" from ${shortId(id)}? It must be empty.`,
				{ assumeYes: Boolean(globalOptions(command).yes), signal: ctx.signal },
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
			if (ctx.settings.collection === name) {
				await updateActiveProfile(globalOptions(command), {
					collection: undefined,
				});
			}
			ctx.output.result(
				`Deleted collection "${name}". (tx: ${result.digest})`,
				result,
			);
		},
	);
}
