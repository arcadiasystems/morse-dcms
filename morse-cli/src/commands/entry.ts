/** `morse entry`: read, add, and delete entries in a collection. */

import {
	addEntryFromBytes,
	deleteEntry,
	type Entry,
} from "@arcadiasystems/morse-sdk";
import type { Command } from "commander";

import {
	buildContentContext,
	buildReadContentContext,
	buildReadContext,
	buildWriteContext,
} from "../cli/context.ts";
import { cancelled, UsageError } from "../cli/errors.ts";
import { readContentBytes, resolveContentType } from "../cli/input.ts";
import { writeFileContents } from "../cli/io.ts";
import { confirm } from "../cli/prompts.ts";
import { globalOptions } from "../cli/runtime.ts";
import { resolveCollection, resolvePublication } from "../cli/target.ts";
import { shortId } from "../format/ids.ts";
import { renderEntry, renderEntryList } from "../format/render.ts";
import { registerEncryptedEntryCommands } from "./encrypted.ts";
import {
	type ContentOptions,
	collectionOption,
	contentOptions,
	publicationOption,
	publisherCapOption,
	type TargetOptions,
} from "./options.ts";
import { resolvePublisherCap } from "./resolve.ts";
import { parseId, parseLimit, parsePositiveInt } from "./shared.ts";

export function registerEntryCommands(program: Command): void {
	const entry = program
		.command("entry")
		.description("Read, add, and delete entries in a collection");

	const get = entry
		.command("get <entryId>")
		.description("Fetch a single entry");
	collectionOption(publicationOption(get)).action(
		async (entryId: string, options: TargetOptions, command: Command) => {
			const ctx = await buildReadContext(command);
			const id = await resolvePublication(ctx, options.publication);
			const collection = resolveCollection(ctx, options.collection);
			const result = await ctx.reader.getEntry(
				id,
				collection,
				parseId(entryId, "entryId"),
				ctx.signal,
			);
			ctx.output.result(renderEntry(result), result);
		},
	);

	const list = entry
		.command("list")
		.description("List entries in a collection")
		.option("--limit <n>", "Maximum results per page")
		.option("--cursor <cursor>", "Continue from a previous page cursor");
	collectionOption(publicationOption(list)).action(
		async (
			options: TargetOptions & { limit?: string; cursor?: string },
			command: Command,
		) => {
			const ctx = await buildReadContext(command);
			const id = await resolvePublication(ctx, options.publication);
			const collection = resolveCollection(ctx, options.collection);
			const page = await ctx.reader.listEntries(id, collection, {
				signal: ctx.signal,
				...(options.limit === undefined
					? {}
					: { limit: parseLimit(options.limit) }),
				...(options.cursor === undefined ? {} : { cursor: options.cursor }),
			});
			if (page.nextCursor !== null) {
				ctx.output.info(`More results: pass --cursor "${page.nextCursor}"`);
			}
			ctx.output.result(renderEntryList(page.results), {
				results: page.results,
				nextCursor: page.nextCursor,
			});
		},
	);

	const scan = entry
		.command("scan")
		.description("List every entry in a collection (auto-paginated)");
	collectionOption(publicationOption(scan)).action(
		async (options: TargetOptions, command: Command) => {
			const ctx = await buildReadContext(command);
			const id = await resolvePublication(ctx, options.publication);
			const collection = resolveCollection(ctx, options.collection);
			const entries: Entry[] = [];
			for await (const item of ctx.reader.scanEntries(id, collection, {
				signal: ctx.signal,
			})) {
				entries.push(item);
			}
			ctx.output.result(renderEntryList(entries), { results: entries });
		},
	);

	const add = entry
		.command("add <name>")
		.description(
			"Upload content from a file or stdin and add it as a new entry",
		);
	collectionOption(
		publicationOption(publisherCapOption(contentOptions(add))),
	).action(async (name: string, options: ContentOptions, command: Command) => {
		const ctx = await buildContentContext(command);
		const id = await resolvePublication(ctx, options.publication);
		const collection = resolveCollection(ctx, options.collection);
		const epochs = parsePositiveInt(options.epochs, "--epochs");
		const bytes = await readContentBytes(options);
		const contentType = resolveContentType(
			options.contentType,
			options.stdin ? undefined : options.file,
		);
		const publisherCapId = await resolvePublisherCap(
			ctx.reader,
			ctx.address,
			id,
			options.publisherCap,
			ctx.signal,
		);
		ctx.output.info(`Uploading ${bytes.length} bytes to Walrus...`);
		const result = await addEntryFromBytes(ctx.adapter, ctx.config, {
			walrus: ctx.walrus,
			publicationId: id,
			publisherCapId,
			collectionName: collection,
			name,
			bytes,
			contentType,
			upload: { epochs, deletable: true },
			signal: ctx.signal,
		});
		const aggregator = ctx.config.walrusEndpoints.aggregator;
		const viewUrl =
			aggregator.length > 0
				? `${aggregator}/v1/blobs/${result.blobId}`
				: undefined;
		const human =
			viewUrl === undefined
				? `Added entry #${result.entryId} "${name}". (tx: ${result.digest})`
				: `Added entry #${result.entryId} "${name}". (tx: ${result.digest})\n  view: ${viewUrl}`;
		ctx.output.result(human, { ...result, viewUrl: viewUrl ?? null });
	});

	const remove = entry
		.command("delete <entryId>")
		.description("Delete an entry and its revisions");
	collectionOption(publicationOption(publisherCapOption(remove))).action(
		async (
			entryId: string,
			options: TargetOptions & { publisherCap?: string },
			command: Command,
		) => {
			const ctx = await buildWriteContext(command);
			const id = await resolvePublication(ctx, options.publication);
			const collection = resolveCollection(ctx, options.collection);
			const numericEntryId = parseId(entryId, "entryId");
			const proceed = await confirm(
				`Delete entry #${numericEntryId} from ${shortId(id)}/${collection}? This cannot be undone.`,
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
			const result = await deleteEntry(ctx.adapter, ctx.config, {
				publicationId: id,
				publisherCapId,
				collectionName: collection,
				entryId: numericEntryId,
				signal: ctx.signal,
			});
			ctx.output.result(
				`Deleted entry #${numericEntryId}. (tx: ${result.digest})`,
				result,
			);
		},
	);

	const read = entry
		.command("read <entryId> [revisionIndex]")
		.description("Fetch a public entry's content to stdout or a file")
		.option("--out <path>", "Write content to a file instead of stdout");
	collectionOption(publicationOption(read)).action(
		async (
			entryId: string,
			revisionId: string | undefined,
			options: TargetOptions & { out?: string },
			command: Command,
		) => {
			const ctx = await buildReadContentContext(command);
			if (ctx.output.isJson && options.out === undefined) {
				throw new UsageError(
					"Reading content to stdout is not supported in --json mode; pass --out <path>.",
				);
			}
			const id = await resolvePublication(ctx, options.publication);
			const collection = resolveCollection(ctx, options.collection);
			const numericEntryId = parseId(entryId, "entryId");
			const entryData = await ctx.reader.getEntry(
				id,
				collection,
				numericEntryId,
				ctx.signal,
			);
			if (revisionId === undefined && entryData.revisions.length === 0) {
				throw new UsageError(`Entry #${numericEntryId} has no revisions.`);
			}
			const revisionIndex =
				revisionId === undefined
					? entryData.revisions.length - 1
					: parseId(revisionId, "revision");
			const revision = entryData.revisions[revisionIndex];
			if (revision === undefined) {
				throw new UsageError(
					`Entry #${numericEntryId} has no revision at index ${revisionIndex}.`,
				);
			}
			if (revision.encrypted) {
				throw new UsageError(
					`Revision #${revisionIndex} of entry #${numericEntryId} is encrypted; use \`morse entry decrypt\`.`,
				);
			}
			ctx.output.info("Fetching content from Walrus...");
			const bytes = await ctx.walrusRead.readBlobRef(revision.blobRef, {
				signal: ctx.signal,
			});
			if (options.out !== undefined) {
				await writeFileContents(options.out, bytes);
				ctx.output.result(`Wrote ${bytes.length} bytes to ${options.out}.`, {
					entryId: numericEntryId,
					revisionId: revisionIndex,
					bytes: bytes.length,
					contentType: revision.contentType,
					out: options.out,
				});
				return;
			}
			process.stdout.write(bytes);
		},
	);

	registerEncryptedEntryCommands(entry);
}
