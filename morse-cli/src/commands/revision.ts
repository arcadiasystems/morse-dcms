/** `morse revision`: append or publish new revisions on an existing entry. */

import {
	appendDraftRevision,
	appendEncryptedDraftRevision,
	type BlobObjectId,
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
import { authorizeContentWrite } from "./preflight.ts";
import { freshPublisherSealId } from "./seal.ts";
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

function uploadReplacement(
	ctx: ContentContext,
	local: LocalContent | undefined,
): Promise<PreparedContent> {
	if (local === undefined) {
		throw new Error("publish-from-draft: replacement content was not read");
	}
	return uploadLocal(ctx, local);
}

function authorize(
	ctx: ContentContext,
	target: ResolvedTarget,
	options: ContentOptions,
	command: string,
): Promise<PublisherCapId> {
	return authorizeContentWrite(ctx, {
		publicationId: target.publicationId,
		collection: target.collection,
		publisherCap: options.publisherCap,
		command: `revision ${command}`,
	});
}

// A draft revision is not a private copy. Walrus stores the blob where anyone
// with the id can read it. On an entry that has never been published, that
// upload discloses plaintext the encrypted revisions were keeping team-only.
function assertPlaintextDraftAllowed(
	entry: Entry,
	allowPublicBlob: boolean,
): void {
	const teamOnly =
		entry.publicHead === null &&
		entry.revisions.some((revision) => revision.encrypted);
	if (!teamOnly || allowPublicBlob) {
		return;
	}
	throw new UsageError(
		`Entry #${entry.id} has encrypted revisions and no public revision. An unencrypted draft is stored as a public Walrus blob, so anyone with the blob id can read it. Pass --allow-public-blob to upload plaintext anyway, or use \`morse revision append-encrypted-draft ${entry.id}\` to keep the draft encrypted.`,
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
	const publisherCapId = await authorize(
		ctx,
		{ publicationId, collection },
		options,
		"publish-direct",
	);
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
	options: ContentOptions & { allowPublicBlob?: boolean },
): Promise<void> {
	const { publicationId, collection } = await resolveTarget(ctx, options);
	const numericEntryId = parseId(entryId, "entryId");
	const local = await readLocalContent(options);
	const entry = await loadEntry(ctx, publicationId, collection, numericEntryId);
	assertPlaintextDraftAllowed(entry, options.allowPublicBlob === true);
	const publisherCapId = await authorize(
		ctx,
		{ publicationId, collection },
		options,
		"append-draft",
	);
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
	// Refuse an encrypted draft before the cap and collection reads. Reusing
	// it would publish ciphertext, and that decision needs only the entry.
	const reused =
		local === undefined ? reuseDraftBlob(entry, draftId) : undefined;
	const publisherCapId = await authorize(
		ctx,
		{ publicationId, collection },
		options,
		"publish-from-draft",
	);
	const prepared =
		reused !== undefined ? reused : await uploadReplacement(ctx, local);
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
	const publisherCapId = await authorize(
		ctx,
		{ publicationId, collection },
		options,
		"append-encrypted-draft",
	);
	const sealId = freshPublisherSealId(publicationId);
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
			.description("Upload content and append it as a draft revision")
			.option(
				"--allow-public-blob",
				"Upload plaintext onto an entry that has encrypted revisions and no public head. The Walrus blob is readable by anyone with its id.",
			),
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
