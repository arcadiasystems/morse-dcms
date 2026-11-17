/** `morse revision`: append or publish new revisions on an existing entry. */

import {
	appendDraftRevision,
	appendEncryptedDraftRevision,
	type BlobObjectId,
	buildPublisherSealId,
	type Entry,
	type PublicationId,
	type PublisherCapId,
	publishDirect,
	publishFromDraft,
} from "@arcadiasystems/morse-sdk";
import type { Command } from "commander";

import {
	buildContentContext,
	buildEncryptContext,
	type ContentContext,
	type EncryptContext,
} from "../cli/context.ts";
import { UsageError } from "../cli/errors.ts";
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

// 16 random bytes is the typical Seal nonce length; the Move layer requires >= 1.
const SEAL_NONCE_BYTES = 16;

// Read the entry before any Walrus upload so a bad id fails on the cheap read.
// Encryption is per revision, so an entry may hold both encrypted drafts and
// public revisions. Callers decide which kind they append.
async function loadEntry(
	ctx: ContentContext,
	publicationId: PublicationId,
	collection: string,
	entryId: number,
): Promise<Entry> {
	return ctx.reader.getEntry(publicationId, collection, entryId, ctx.signal);
}

interface LocalContent {
	readonly bytes: Uint8Array;
	readonly contentType: string;
	readonly epochs: number;
}

// Read and validate content from --file/--stdin without any network IO, so a
// missing content source fails fast before the entry-guard read or any upload.
async function readLocalContent(
	options: ContentOptions,
): Promise<LocalContent> {
	const epochs = parsePositiveInt(options.epochs, "--epochs");
	const bytes = await readContentBytes(options);
	const contentType = resolveContentType(
		options.contentType,
		options.stdin ? undefined : options.file,
	);
	return { bytes, contentType, epochs };
}

async function uploadLocal(
	ctx: ContentContext,
	local: LocalContent,
): Promise<PreparedContent> {
	ctx.output.info(`Uploading ${local.bytes.length} bytes to Walrus...`);
	const upload = await ctx.walrus.uploadBlob(local.bytes, {
		epochs: local.epochs,
		deletable: true,
	});
	// Surface the blob id before the on-chain op so a failed attach leaves the
	// stranded (but paid-for) blob id visible on stderr for recovery.
	ctx.output.info(
		`Blob uploaded (${upload.blobObjectId}). Submitting transaction...`,
	);
	return { blobObjectId: upload.blobObjectId, contentType: local.contentType };
}

function capFor(
	ctx: ContentContext,
	publicationId: PublicationId,
	options: ContentOptions,
): Promise<PublisherCapId> {
	return resolvePublisherCap(
		ctx.reader,
		ctx.address,
		publicationId,
		options.publisherCap,
		ctx.signal,
	);
}

export async function runRevisionPublishDirect(
	ctx: ContentContext,
	entryId: string,
	options: ContentOptions,
): Promise<void> {
	const { publicationId, collection } = await resolveTarget(ctx, options);
	const numericEntryId = parseId(entryId, "entryId");
	const local = await readLocalContent(options);
	await loadEntry(ctx, publicationId, collection, numericEntryId);
	const publisherCapId = await capFor(ctx, publicationId, options);
	const prepared = await uploadLocal(ctx, local);
	const result = await publishDirect(ctx.adapter, ctx.config, {
		publicationId,
		publisherCapId,
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
	const local = await readLocalContent(options);
	await loadEntry(ctx, publicationId, collection, numericEntryId);
	const publisherCapId = await capFor(ctx, publicationId, options);
	const prepared = await uploadLocal(ctx, local);
	const result = await appendDraftRevision(ctx.adapter, ctx.config, {
		publicationId,
		publisherCapId,
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

// Resolve the draft revision's existing blob so the reviewed bytes are
// published unchanged (no re-upload, no extra WAL).
function reuseDraftBlob(
	entry: Entry,
	draftRevisionId: number,
): PreparedContent {
	const draft = entry.revisions.find((r) => r.id === draftRevisionId);
	if (draft === undefined) {
		throw new UsageError(
			`Entry #${entry.id} has no revision #${draftRevisionId} to publish.`,
		);
	}
	if (draft.encrypted) {
		throw new UsageError(
			`Draft #${draftRevisionId} of entry #${entry.id} is encrypted. Reusing its blob would publish the ciphertext as the public revision. Pass the plaintext with --file or --stdin.`,
		);
	}
	if (draft.blobRef.kind !== "blob") {
		throw new UsageError(
			`Draft #${draftRevisionId} uses quilt storage, which cannot be reused; pass --file or --stdin to publish new content.`,
		);
	}
	return {
		blobObjectId: draft.blobRef.blobObjectId,
		contentType: draft.contentType,
	};
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
	// Read replacement content (if any) offline first, so a bad file path fails
	// before the entry-guard read and the cap lookup, matching the other two
	// revision commands.
	const providedNewContent =
		options.file !== undefined || Boolean(options.stdin);
	const local = providedNewContent
		? await readLocalContent(options)
		: undefined;
	const entry = await loadEntry(ctx, publicationId, collection, numericEntryId);
	const publisherCapId = await capFor(ctx, publicationId, options);
	const prepared =
		local === undefined
			? reuseDraftBlob(entry, draftId)
			: await uploadLocal(ctx, local);
	const result = await publishFromDraft(ctx.adapter, ctx.config, {
		publicationId,
		publisherCapId,
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

export async function runRevisionAppendEncryptedDraft(
	ctx: EncryptContext,
	entryId: string,
	options: ContentOptions,
): Promise<void> {
	const { publicationId, collection } = await resolveTarget(ctx, options);
	const numericEntryId = parseId(entryId, "entryId");
	const local = await readLocalContent(options);
	await loadEntry(ctx, publicationId, collection, numericEntryId);
	const publisherCapId = await capFor(ctx, publicationId, options);
	const sealId = buildPublisherSealId(
		publicationId,
		crypto.getRandomValues(new Uint8Array(SEAL_NONCE_BYTES)),
	);
	ctx.output.info(`Encrypting ${local.bytes.length} bytes...`);
	const { ciphertext } = await ctx.seal().encrypt(local.bytes, { sealId });
	ctx.output.info(`Uploading ${ciphertext.length} bytes to Walrus...`);
	const upload = await ctx.walrus.uploadBlob(ciphertext, {
		epochs: local.epochs,
		deletable: true,
	});
	ctx.output.info(
		`Blob uploaded (${upload.blobObjectId}). Submitting transaction...`,
	);
	const result = await appendEncryptedDraftRevision(ctx.adapter, ctx.config, {
		publicationId,
		publisherCapId,
		collectionName: collection,
		entryId: numericEntryId,
		blobObjectId: upload.blobObjectId,
		contentType: local.contentType,
		sealId,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Appended encrypted draft revision #${result.revisionId} on entry #${numericEntryId}. (tx: ${result.digest})`,
		{ ...result, sealId },
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
				"Publish a draft as a new public revision (reuses an unencrypted draft blob; pass --file/--stdin to publish replacement plaintext, required when the draft is encrypted)",
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

	revisionOptions(
		revision
			.command("append-encrypted-draft <entryId>")
			.description(
				"Encrypt content with Seal and append it as a draft revision on an existing entry",
			),
	).action(
		async (entryId: string, options: ContentOptions, command: Command) => {
			await runRevisionAppendEncryptedDraft(
				await buildEncryptContext(command),
				entryId,
				options,
			);
		},
	);
}
