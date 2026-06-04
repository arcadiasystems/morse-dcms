/** `morse file`: register, read, mutate, and delete encrypted/public file metadata. */

import {
	buildAllowlistSealId,
	createEncryptedFile,
	createPublicFile,
	deleteFile,
	type EncryptedFile,
	type EncryptedFileSummary,
	type EncryptedFileSummaryOrFull,
	type FileUploadProgressEvent,
	reconcileFilesAccessibleBy,
	reconcileFilesOwnedBy,
	type SealId,
	toAllowlistId,
	toBlobObjectId,
	toEncryptedFileId,
	toSuiAddress,
	toWalrusBlobId,
	transferFileOwnership,
	updateFileMetadata,
	uploadEncryptedFileFromBytes,
	uploadPublicFileFromBytes,
} from "@arcadiasystems/morse-sdk";
import { SessionKey } from "@mysten/seal";
import type { Command } from "commander";

import {
	buildEncryptContext,
	buildFileDownloadContext,
	buildFileListContext,
	buildFilesReadContext,
	buildWriteContext,
	type EncryptContext,
	type FileDownloadContext,
	type FileListContext,
	type FilesReadContext,
	type WriteContext,
} from "../cli/context.ts";
import { cancelled, UsageError } from "../cli/errors.ts";
import { fetchEventStreams } from "../cli/events.ts";
import { readContentBytes, resolveContentType } from "../cli/input.ts";
import { writeFileContents } from "../cli/io.ts";
import type { GlobalOptions } from "../cli/program.ts";
import { confirm } from "../cli/prompts.ts";
import { globalOptions } from "../cli/runtime.ts";
import { decodeHex, encodeHex } from "../format/hex.ts";
import { shortId } from "../format/ids.ts";
import { renderEncryptedFile, renderFileList } from "../format/render.ts";
import { allowlistOption, viaAggregatorOption } from "./options.ts";
import { parseByteSize, parseLimit, parsePositiveInt } from "./shared.ts";

// SessionKey lifetime; long enough for one decrypt, short enough to limit reuse.
const SESSION_KEY_TTL_MIN = 10;

// 16 random bytes is the standard Seal nonce length; the Move layer requires >= 1.
const SEAL_NONCE_BYTES = 16;

interface UploadOptions {
	readonly name: string;
	readonly allowlist?: string;
	readonly public?: boolean;
	readonly contentType?: string;
	readonly epochs?: string;
}

function uploadProgress(
	output: EncryptContext["output"],
): (event: FileUploadProgressEvent) => void {
	const labels: Record<FileUploadProgressEvent["phase"], string> = {
		encrypting: "Encrypting...",
		uploading: "Uploading to Walrus...",
		submitting: "Submitting transaction...",
		complete: "",
	};
	return (event) => {
		const label = labels[event.phase];
		if (label.length > 0) {
			output.info(label);
		}
	};
}

interface RegisterOptions {
	readonly blobId: string;
	readonly name: string;
	readonly contentType: string;
	readonly size: string;
	readonly allowlist?: string;
	readonly public?: boolean;
	readonly blobObjectId?: string;
}

export async function runFileGet(
	ctx: FilesReadContext,
	target: string,
): Promise<void> {
	const result = await ctx.filesReader.getEncryptedFile(
		toEncryptedFileId(target),
		ctx.signal,
	);
	ctx.output.result(renderEncryptedFile(result), result);
}

export async function runFileRegister(
	ctx: WriteContext,
	options: RegisterOptions,
): Promise<void> {
	if (options.allowlist === undefined && options.public !== true) {
		throw new UsageError(
			"Pass --allowlist <id> to register an encrypted file, or --public for a world-readable one.",
		);
	}
	const blobId = toWalrusBlobId(options.blobId);
	const size = parseByteSize(options.size, "--size");
	const blobObjectId =
		options.blobObjectId === undefined
			? undefined
			: toBlobObjectId(options.blobObjectId);
	if (options.allowlist !== undefined) {
		const result = await createEncryptedFile(ctx.adapter, ctx.config, {
			allowlistId: toAllowlistId(options.allowlist),
			blobId,
			...(blobObjectId === undefined ? {} : { blobObjectId }),
			name: options.name,
			contentType: options.contentType,
			size,
			signal: ctx.signal,
		});
		ctx.output.result(
			`Registered encrypted file ${result.fileId}. (tx: ${result.digest})`,
			result,
		);
		return;
	}
	const result = await createPublicFile(ctx.adapter, ctx.config, {
		blobId,
		...(blobObjectId === undefined ? {} : { blobObjectId }),
		name: options.name,
		contentType: options.contentType,
		size,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Registered public file ${result.fileId}. (tx: ${result.digest})`,
		result,
	);
}

export async function runFileUpdate(
	ctx: WriteContext,
	target: string,
	options: { name: string; contentType: string },
): Promise<void> {
	const result = await updateFileMetadata(ctx.adapter, ctx.config, {
		fileId: toEncryptedFileId(target),
		name: options.name,
		contentType: options.contentType,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Updated file ${shortId(target)} metadata. (tx: ${result.digest})`,
		result,
	);
}

export async function runFileTransferOwnership(
	ctx: WriteContext,
	target: string,
	newOwner: string,
	gopts: GlobalOptions,
): Promise<void> {
	const fileId = toEncryptedFileId(target);
	const to = toSuiAddress(newOwner);
	const proceed = await confirm(
		`Transfer metadata ownership of file ${shortId(fileId)} to ${to}? Decryption access is governed separately by the allowlist.`,
		{ assumeYes: Boolean(gopts.yes), signal: ctx.signal },
	);
	if (!proceed) {
		cancelled();
	}
	const result = await transferFileOwnership(ctx.adapter, ctx.config, {
		fileId,
		newOwner: to,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Transferred file ownership to ${to}. (tx: ${result.digest})`,
		result,
	);
}

export async function runFileDelete(
	ctx: WriteContext,
	target: string,
	gopts: GlobalOptions,
): Promise<void> {
	const fileId = toEncryptedFileId(target);
	const proceed = await confirm(
		`Delete file metadata ${shortId(fileId)}? The Walrus blob is not deleted; it expires on its own lease.`,
		{ assumeYes: Boolean(gopts.yes), signal: ctx.signal },
	);
	if (!proceed) {
		cancelled();
	}
	const result = await deleteFile(ctx.adapter, ctx.config, {
		fileId,
		signal: ctx.signal,
	});
	ctx.output.result(`Deleted file ${fileId}. (tx: ${result.digest})`, result);
}

export async function runFileUpload(
	ctx: EncryptContext,
	path: string,
	options: UploadOptions,
): Promise<void> {
	if (options.allowlist === undefined && options.public !== true) {
		throw new UsageError(
			"Pass --allowlist <id> to upload an encrypted file, or --public for a world-readable one.",
		);
	}
	const epochs = parsePositiveInt(options.epochs ?? "3", "--epochs");
	const bytes = await readContentBytes({ file: path });
	const contentType = resolveContentType(options.contentType, path);
	const upload = { epochs, deletable: true };
	const onProgress = uploadProgress(ctx.output);

	if (options.allowlist !== undefined) {
		const allowlistId = toAllowlistId(options.allowlist);
		const sealId = buildAllowlistSealId(
			allowlistId,
			crypto.getRandomValues(new Uint8Array(SEAL_NONCE_BYTES)),
		);
		const result = await uploadEncryptedFileFromBytes(ctx.adapter, ctx.config, {
			walrus: ctx.walrus,
			seal: ctx.seal,
			allowlistId,
			sealId,
			plaintext: bytes,
			name: options.name,
			contentType,
			upload,
			signal: ctx.signal,
			onProgress,
		});
		const sealIdHex = encodeHex(sealId);
		const human = [
			`Uploaded encrypted file ${result.fileId}`,
			`  blobId: ${result.blobId}`,
			`  sealId: ${sealIdHex}`,
			`  tx:     ${result.digest}`,
			"Save the seal id: decrypting later needs it plus allowlist membership.",
		].join("\n");
		ctx.output.result(human, { ...result, sealId: sealIdHex });
		return;
	}

	const result = await uploadPublicFileFromBytes(ctx.adapter, ctx.config, {
		walrus: ctx.walrus,
		bytes,
		name: options.name,
		contentType,
		upload,
		signal: ctx.signal,
		onProgress,
	});
	const aggregator = ctx.config.walrusEndpoints.aggregator;
	const viewUrl =
		aggregator.length > 0
			? `${aggregator}/v1/blobs/${result.blobId}`
			: undefined;
	const human =
		viewUrl === undefined
			? `Uploaded public file ${result.fileId}. (tx: ${result.digest})`
			: `Uploaded public file ${result.fileId}. (tx: ${result.digest})\n  view: ${viewUrl}`;
	ctx.output.result(human, { ...result, viewUrl: viewUrl ?? null });
}

async function decryptFile(
	ctx: FileDownloadContext,
	file: EncryptedFile,
	ciphertext: Uint8Array,
	sealIdHex: string | undefined,
): Promise<Uint8Array> {
	if (sealIdHex === undefined) {
		throw new UsageError(
			"This file is encrypted; pass --seal-id <hex> (printed when the file was uploaded).",
		);
	}
	if (file.allowlistId === null) {
		throw new UsageError(
			`File ${file.id} is marked encrypted but carries no allowlist; it cannot be decrypted.`,
		);
	}
	const sealId = decodeHex(sealIdHex) as unknown as SealId;
	const { keypair, address } = await ctx.unlockSigner();
	ctx.output.info("Signing a SessionKey with the active account...");
	const sessionKey = await SessionKey.create({
		address,
		packageId: ctx.config.originalPackageId ?? ctx.config.packageId,
		ttlMin: SESSION_KEY_TTL_MIN,
		signer: keypair,
		suiClient: ctx.client,
	});
	return ctx.seal.decryptUnderAllowlist(ciphertext, {
		sealId,
		allowlistId: file.allowlistId,
		sessionKey,
	});
}

export async function runFileDownload(
	ctx: FileDownloadContext,
	target: string,
	options: { out?: string; sealId?: string },
): Promise<void> {
	if (ctx.output.isJson && options.out === undefined) {
		throw new UsageError(
			"Downloading content to stdout is not supported in --json mode; pass --out <path>.",
		);
	}
	const file = await ctx.filesReader.getEncryptedFile(
		toEncryptedFileId(target),
		ctx.signal,
	);
	ctx.output.info("Fetching content from Walrus...");
	const bytes = await ctx.walrusRead.readBlob(file.blobId, {
		signal: ctx.signal,
	});
	let content = bytes;
	if (file.encrypted) {
		content = await decryptFile(ctx, file, bytes, options.sealId);
	}
	if (options.out !== undefined) {
		await writeFileContents(options.out, content);
		ctx.output.result(`Wrote ${content.length} bytes to ${options.out}.`, {
			fileId: file.id,
			name: file.name,
			contentType: file.contentType,
			bytes: content.length,
			out: options.out,
		});
		return;
	}
	process.stdout.write(content);
}

interface ListOptions {
	readonly address?: string;
	readonly accessible?: boolean;
	readonly hydrate?: boolean;
	readonly limit?: string;
}

export async function runFileList(
	ctx: FileListContext,
	options: ListOptions,
): Promise<void> {
	// Validate flags before the event fetch so a bad value fails fast.
	const limit =
		options.limit === undefined ? undefined : parseLimit(options.limit);
	const address =
		options.address === undefined
			? ctx.ownerAddress
			: toSuiAddress(options.address);
	if (address === undefined) {
		throw new UsageError(
			"No address given and no active account. Pass --address or import an account.",
		);
	}
	const types = ctx.eventTypes;
	let summaries: EncryptedFileSummary[];
	if (options.accessible) {
		ctx.output.info("Fetching membership and file events...");
		const events = await fetchEventStreams(
			ctx.events,
			[
				types.MemberAdded,
				types.MemberRemoved,
				types.AllowlistDeleted,
				types.FileCreated,
				types.FileDeleted,
			],
			ctx.signal,
		);
		summaries = reconcileFilesAccessibleBy(events, address, types);
	} else {
		ctx.output.info("Fetching file events...");
		const events = await fetchEventStreams(
			ctx.events,
			[types.FileCreated, types.FileOwnershipTransferred, types.FileDeleted],
			ctx.signal,
		);
		summaries = reconcileFilesOwnedBy(events, address, types);
	}
	const limited = limit === undefined ? summaries : summaries.slice(0, limit);
	let items: EncryptedFileSummaryOrFull[] = limited;
	if (options.hydrate) {
		ctx.output.info(`Hydrating ${limited.length} file(s)...`);
		const full: EncryptedFileSummaryOrFull[] = [];
		for (const summary of limited) {
			const record = await ctx.filesReader.getEncryptedFile(
				summary.id,
				ctx.signal,
			);
			full.push({ ...record, kind: "full" });
		}
		items = full;
	}
	ctx.output.result(renderFileList(items), items);
}

export function registerFileCommands(program: Command): void {
	const file = program
		.command("file")
		.description("Upload, register, read, and manage files on Walrus");

	const upload = file
		.command("upload <path>")
		.description("Encrypt (or not), upload to Walrus, and register a file")
		.requiredOption("-n, --name <name>", "File name")
		.option("--public", "Upload a world-readable (unencrypted) file")
		.option(
			"--content-type <mime>",
			"MIME content type (inferred from the path if omitted)",
		)
		.option("--epochs <n>", "Walrus storage epochs", "3");
	allowlistOption(upload).action(
		async (path: string, options: UploadOptions, command: Command) => {
			await runFileUpload(await buildEncryptContext(command), path, options);
		},
	);

	file
		.command("list")
		.description(
			"List files owned by (or accessible to) an address, via event indexing",
		)
		.option(
			"--address <addr>",
			"Address to query (default: the active account)",
		)
		.option(
			"--accessible",
			"List files you can decrypt via allowlist membership, not just owned",
		)
		.option("--hydrate", "Fetch full records (adds blobId; one read per file)")
		.option("--limit <n>", "Cap the number of results")
		.option(
			"--indexer-url <url>",
			"Event source URL (default: the RPC; uses suix_queryEvents, a deprecated Sui endpoint)",
		)
		.action(
			async (
				options: ListOptions & { indexerUrl?: string },
				command: Command,
			) => {
				await runFileList(
					await buildFileListContext(command, {
						indexerUrl: options.indexerUrl,
					}),
					options,
				);
			},
		);

	const download = file
		.command("download <file>")
		.description("Download a file's content; decrypts in place when encrypted")
		.option("--out <path>", "Write content to a file instead of stdout")
		.option(
			"--seal-id <hex>",
			"Seal id from upload (required to decrypt an encrypted file)",
		);
	viaAggregatorOption(download).action(
		async (
			target: string,
			options: { out?: string; sealId?: string; viaAggregator?: boolean },
			command: Command,
		) => {
			await runFileDownload(
				await buildFileDownloadContext(command, {
					viaAggregator: options.viaAggregator,
				}),
				target,
				options,
			);
		},
	);

	file
		.command("get <file>")
		.description("Fetch a file's on-chain metadata")
		.action(async (target: string, _options, command: Command) => {
			await runFileGet(await buildFilesReadContext(command), target);
		});

	const register = file
		.command("register")
		.description("Register on-chain metadata for a blob already on Walrus")
		.requiredOption("--blob-id <id>", "Walrus content id")
		.requiredOption("-n, --name <name>", "File name")
		.requiredOption("--content-type <mime>", "MIME content type")
		.requiredOption("--size <bytes>", "Plaintext byte length")
		.option("--public", "Register a world-readable (unencrypted) file")
		.option(
			"--blob-object-id <id>",
			"On-chain Walrus Blob object id, if known",
		);
	allowlistOption(register).action(
		async (options: RegisterOptions, command: Command) => {
			await runFileRegister(await buildWriteContext(command), options);
		},
	);

	file
		.command("update <file>")
		.description("Update a file's name and content type (owner only)")
		.requiredOption("-n, --name <name>", "New file name")
		.requiredOption("--content-type <mime>", "New MIME content type")
		.action(
			async (
				target: string,
				options: { name: string; contentType: string },
				command: Command,
			) => {
				await runFileUpdate(await buildWriteContext(command), target, options);
			},
		);

	file
		.command("transfer-ownership <file> <newOwner>")
		.description(
			"Transfer a file's metadata-mutation right (not decrypt access)",
		)
		.action(
			async (target: string, newOwner: string, _options, command: Command) => {
				await runFileTransferOwnership(
					await buildWriteContext(command),
					target,
					newOwner,
					globalOptions(command),
				);
			},
		);

	file
		.command("delete <file>")
		.description("Delete a file's metadata record (does not delete the blob)")
		.action(async (target: string, _options, command: Command) => {
			await runFileDelete(
				await buildWriteContext(command),
				target,
				globalOptions(command),
			);
		});
}
