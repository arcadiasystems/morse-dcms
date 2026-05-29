/**
 * Encrypted entries via Seal: `entry add-encrypted` (encrypt + upload + add) and
 * `entry decrypt` (fetch ciphertext, sign a SessionKey, recover plaintext).
 * Registered onto the existing `entry` command so they group with the rest.
 */

import {
	addEncryptedEntryFromBytes,
	buildPublisherSealId,
} from "@arcadiasystems/morse-sdk";
import { SessionKey } from "@mysten/seal";
import type { Command } from "commander";

import { buildDecryptContext, buildEncryptContext } from "../cli/context.ts";
import { UsageError } from "../cli/errors.ts";
import { readContentBytes, resolveContentType } from "../cli/input.ts";
import { resolveCollection, resolvePublication } from "../cli/target.ts";
import {
	type ContentOptions,
	collectionOption,
	contentOptions,
	publicationOption,
	publisherCapOption,
	type TargetOptions,
} from "./options.ts";
import { resolvePublisherCap } from "./resolve.ts";
import { parseId, parsePositiveInt } from "./shared.ts";

// SessionKey lifetime; long enough for one decrypt, short enough to limit reuse.
const SESSION_KEY_TTL_MIN = 10;
// 16 random bytes is the typical Seal nonce length; the Move layer requires >= 1.
const SEAL_NONCE_BYTES = 16;

export function registerEncryptedEntryCommands(entry: Command): void {
	const add = entry
		.command("add-encrypted <name>")
		.description("Encrypt a file or stdin with Seal and add it as a new entry");
	collectionOption(
		publicationOption(publisherCapOption(contentOptions(add))),
	).action(async (name: string, options: ContentOptions, command: Command) => {
		const ctx = await buildEncryptContext(command);
		const id = await resolvePublication(ctx, options.publication);
		const collection = resolveCollection(ctx, options.collection);
		const epochs = parsePositiveInt(options.epochs, "--epochs");
		const plaintext = await readContentBytes(options);
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
		const sealId = buildPublisherSealId(
			id,
			crypto.getRandomValues(new Uint8Array(SEAL_NONCE_BYTES)),
		);
		ctx.output.info(`Encrypting and uploading ${plaintext.length} bytes...`);
		const result = await addEncryptedEntryFromBytes(ctx.adapter, ctx.config, {
			walrus: ctx.walrus,
			seal: ctx.seal,
			publicationId: id,
			publisherCapId,
			collectionName: collection,
			name,
			plaintext,
			contentType,
			sealId,
			upload: { epochs, deletable: true },
			signal: ctx.signal,
		});
		ctx.output.result(
			`Added encrypted entry #${result.entryId} "${name}". (tx: ${result.digest})`,
			{ ...result, sealId },
		);
	});

	const decrypt = entry
		.command("decrypt <entryId> [revisionIndex]")
		.description(
			"Decrypt an encrypted revision by zero-based index (default: latest); signs a SessionKey with the active account",
		)
		.option("--out <path>", "Write plaintext to a file instead of stdout");
	collectionOption(publicationOption(publisherCapOption(decrypt))).action(
		async (
			entryId: string,
			revisionId: string | undefined,
			options: TargetOptions & { out?: string; publisherCap?: string },
			command: Command,
		) => {
			const ctx = await buildDecryptContext(command);
			// Validate the output mode before paying for the Walrus read and the
			// Seal key-server round-trip.
			if (ctx.output.isJson && options.out === undefined) {
				throw new UsageError(
					"Decrypting to stdout is not supported in --json mode; pass --out <path>.",
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
			if (!revision.encrypted || revision.sealId === null) {
				throw new UsageError(
					`Revision #${revisionIndex} of entry #${numericEntryId} is not encrypted.`,
				);
			}
			const publisherCapId = await resolvePublisherCap(
				ctx.reader,
				ctx.address,
				id,
				options.publisherCap,
				ctx.signal,
			);
			ctx.output.info("Fetching ciphertext from Walrus...");
			const ciphertext = await ctx.walrusRead.readBlobRef(revision.blobRef, {
				signal: ctx.signal,
			});
			ctx.output.info("Signing a SessionKey with the active account...");
			const sessionKey = await SessionKey.create({
				address: ctx.address,
				packageId: ctx.config.originalPackageId ?? ctx.config.packageId,
				ttlMin: SESSION_KEY_TTL_MIN,
				signer: ctx.keypair,
				suiClient: ctx.client,
			});
			const plaintext = await ctx.seal.decrypt(ciphertext, {
				sessionKey,
				sealId: revision.sealId,
				publisherCapId,
			});
			if (options.out !== undefined) {
				await Bun.write(options.out, plaintext);
				ctx.output.result(
					`Wrote ${plaintext.length} bytes to ${options.out}.`,
					{
						entryId: numericEntryId,
						revisionId: revisionIndex,
						bytes: plaintext.length,
						contentType: revision.contentType,
						out: options.out,
					},
				);
				return;
			}
			process.stdout.write(plaintext);
		},
	);
}
