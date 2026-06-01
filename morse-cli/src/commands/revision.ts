/** `morse revision`: append or publish new revisions on an existing entry. */

import {
	appendDraftRevision,
	type BlobObjectId,
	type PublicationId,
	type PublisherCapId,
	publishDirect,
	publishFromDraft,
} from "@arcadiasystems/morse-sdk";
import type { Command } from "commander";

import { buildContentContext, type ContentContext } from "../cli/context.ts";
import { readContentBytes, resolveContentType } from "../cli/input.ts";
import { resolveCollection, resolvePublication } from "../cli/target.ts";
import {
	type ContentOptions,
	collectionOption,
	contentOptions,
	publicationOption,
	publisherCapOption,
} from "./options.ts";
import { resolvePublisherCap } from "./resolve.ts";
import { parseId, parsePositiveInt } from "./shared.ts";

interface ResolvedTarget {
	readonly publicationId: PublicationId;
	readonly collection: string;
}

interface PreparedContent {
	readonly blobObjectId: BlobObjectId;
	readonly contentType: string;
	readonly publisherCapId: PublisherCapId;
}

function revisionOptions(command: Command): Command {
	return collectionOption(
		publicationOption(publisherCapOption(contentOptions(command))),
	);
}

async function resolveTarget(
	ctx: ContentContext,
	options: ContentOptions,
): Promise<ResolvedTarget> {
	const publicationId = await resolvePublication(ctx, options.publication);
	const collection = resolveCollection(ctx, options.collection);
	return { publicationId, collection };
}

async function prepareContent(
	ctx: ContentContext,
	publicationId: PublicationId,
	options: ContentOptions,
): Promise<PreparedContent> {
	const epochs = parsePositiveInt(options.epochs, "--epochs");
	const bytes = await readContentBytes(options);
	const contentType = resolveContentType(
		options.contentType,
		options.stdin ? undefined : options.file,
	);
	const publisherCapId = await resolvePublisherCap(
		ctx.reader,
		ctx.address,
		publicationId,
		options.publisherCap,
		ctx.signal,
	);
	ctx.output.info(`Uploading ${bytes.length} bytes to Walrus...`);
	const upload = await ctx.walrus.uploadBlob(bytes, {
		epochs,
		deletable: true,
	});
	// Surface the blob id before the on-chain op so a failed attach leaves the
	// stranded (but paid-for) blob id visible on stderr for recovery.
	ctx.output.info(
		`Blob uploaded (${upload.blobObjectId}). Submitting transaction...`,
	);
	return { blobObjectId: upload.blobObjectId, contentType, publisherCapId };
}

export async function runRevisionPublishDirect(
	ctx: ContentContext,
	entryId: string,
	options: ContentOptions,
): Promise<void> {
	const { publicationId, collection } = await resolveTarget(ctx, options);
	const numericEntryId = parseId(entryId, "entryId");
	const prepared = await prepareContent(ctx, publicationId, options);
	const result = await publishDirect(ctx.adapter, ctx.config, {
		publicationId,
		publisherCapId: prepared.publisherCapId,
		collectionName: collection,
		entryId: numericEntryId,
		blobObjectId: prepared.blobObjectId,
		contentType: prepared.contentType,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Published revision #${result.revisionId} on entry #${numericEntryId}. (tx: ${result.digest})`,
		result,
	);
}

export async function runRevisionAppendDraft(
	ctx: ContentContext,
	entryId: string,
	options: ContentOptions,
): Promise<void> {
	const { publicationId, collection } = await resolveTarget(ctx, options);
	const numericEntryId = parseId(entryId, "entryId");
	const prepared = await prepareContent(ctx, publicationId, options);
	const result = await appendDraftRevision(ctx.adapter, ctx.config, {
		publicationId,
		publisherCapId: prepared.publisherCapId,
		collectionName: collection,
		entryId: numericEntryId,
		blobObjectId: prepared.blobObjectId,
		contentType: prepared.contentType,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Appended draft revision #${result.revisionId} on entry #${numericEntryId}. (tx: ${result.digest})`,
		result,
	);
}

export async function runRevisionPublishFromDraft(
	ctx: ContentContext,
	entryId: string,
	draftRevisionId: string,
	options: ContentOptions,
): Promise<void> {
	const { publicationId, collection } = await resolveTarget(ctx, options);
	const numericEntryId = parseId(entryId, "entryId");
	const draftId = parseId(draftRevisionId, "draftRevisionId");
	const prepared = await prepareContent(ctx, publicationId, options);
	const result = await publishFromDraft(ctx.adapter, ctx.config, {
		publicationId,
		publisherCapId: prepared.publisherCapId,
		collectionName: collection,
		entryId: numericEntryId,
		draftRevisionId: draftId,
		blobObjectId: prepared.blobObjectId,
		contentType: prepared.contentType,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Published revision #${result.revisionId} from draft #${draftId} on entry #${numericEntryId}. (tx: ${result.digest})`,
		result,
	);
}

export function registerRevisionCommands(program: Command): void {
	const revision = program
		.command("revision")
		.description("Append or publish revisions on an entry");

	revisionOptions(
		revision
			.command("publish-direct <entryId>")
			.description("Upload content and append it as a public revision"),
	).action(
		async (entryId: string, options: ContentOptions, command: Command) => {
			await runRevisionPublishDirect(
				await buildContentContext(command),
				entryId,
				options,
			);
		},
	);

	revisionOptions(
		revision
			.command("append-draft <entryId>")
			.description("Upload content and append it as a draft revision"),
	).action(
		async (entryId: string, options: ContentOptions, command: Command) => {
			await runRevisionAppendDraft(
				await buildContentContext(command),
				entryId,
				options,
			);
		},
	);

	revisionOptions(
		revision
			.command("publish-from-draft <entryId> <draftRevisionId>")
			.description(
				"Upload content and publish it as a new revision, referencing a draft",
			),
	).action(
		async (
			entryId: string,
			draftRevisionId: string,
			options: ContentOptions,
			command: Command,
		) => {
			await runRevisionPublishFromDraft(
				await buildContentContext(command),
				entryId,
				draftRevisionId,
				options,
			);
		},
	);
}
