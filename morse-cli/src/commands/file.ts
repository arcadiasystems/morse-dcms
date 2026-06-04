/** `morse file`: upload, register, read, list, download, and manage RecipientFiles. */

import {
	addRecipient,
	buildRecipientFileSealId,
	createEncryptedRecipientFile,
	createRecipientFile,
	deleteRecipientFile,
	type FileUploadProgressEvent,
	type RecipientFileSummary,
	type RecipientFileSummaryOrFull,
	reconcileRecipientFilesAccessibleBy,
	reconcileRecipientFilesOwnedBy,
	removeRecipient,
	type SealId,
	toBlobObjectId,
	toRecipientFileId,
	toSuiAddress,
	toWalrusBlobId,
	transferRecipientFileOwnership,
	updateRecipientFileMetadata,
	uploadEncryptedRecipientFileFromBytes,
	uploadRecipientFileFromBytes,
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
import { renderFileList, renderRecipientFile } from "../format/render.ts";
import { decodeShare, encodeShare } from "../format/share.ts";
import { recipientOption, viaAggregatorOption } from "./options.ts";
import { parseByteSize, parseLimit, parsePositiveInt } from "./shared.ts";

// SessionKey lifetime; long enough for one decrypt, short enough to limit reuse.
const SESSION_KEY_TTL_MIN = 10;

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

export async function runFileGet(
	ctx: FilesReadContext,
	target: string,
): Promise<void> {
	const result = await ctx.filesReader.getRecipientFile(
		toRecipientFileId(target),
		ctx.signal,
	);
	ctx.output.result(renderRecipientFile(result), result);
}

interface RegisterOptions {
	readonly blobId: string;
	readonly name: string;
	readonly contentType: string;
	readonly size: string;
	readonly recipient?: string[];
	readonly public?: boolean;
	readonly encrypted?: boolean;
	readonly sealPrefix?: string;
	readonly blobObjectId?: string;
}

export async function runFileRegister(
	ctx: WriteContext,
	options: RegisterOptions,
): Promise<void> {
	if (options.public && options.encrypted) {
		throw new UsageError("Pass --public or --encrypted, not both.");
	}
	const recipients = (options.recipient ?? []).map((r) => toSuiAddress(r));
	const blobId = toWalrusBlobId(options.blobId);
	const size = parseByteSize(options.size, "--size");
	const blobObjectId =
		options.blobObjectId === undefined
			? undefined
			: toBlobObjectId(options.blobObjectId);
	const common = {
		blobId,
		...(blobObjectId === undefined ? {} : { blobObjectId }),
		name: options.name,
		contentType: options.contentType,
		size,
		recipients,
		signal: ctx.signal,
	};
	if (options.encrypted) {
		if (options.sealPrefix === undefined) {
			throw new UsageError(
				"--encrypted requires --seal-prefix <hex> (the prefix the blob was encrypted under).",
			);
		}
		const result = await createEncryptedRecipientFile(ctx.adapter, ctx.config, {
			...common,
			sealIdPrefix: decodeHex(options.sealPrefix),
		});
		ctx.output.result(
			`Registered encrypted file ${result.fileId}. (tx: ${result.digest})`,
			result,
		);
		return;
	}
	if (options.public) {
		const result = await createRecipientFile(ctx.adapter, ctx.config, common);
		ctx.output.result(
			`Registered public file ${result.fileId}. (tx: ${result.digest})`,
			result,
		);
		return;
	}
	throw new UsageError(
		"Pass --public for a world-readable file, or --encrypted --seal-prefix <hex>.",
	);
}

export async function runFileUpdate(
	ctx: WriteContext,
	target: string,
	options: { name: string; contentType: string },
): Promise<void> {
	const result = await updateRecipientFileMetadata(ctx.adapter, ctx.config, {
		fileId: toRecipientFileId(target),
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
	const fileId = toRecipientFileId(target);
	const to = toSuiAddress(newOwner);
	const proceed = await confirm(
		`Transfer ownership of file ${shortId(fileId)} to ${to}? Recipient access is governed separately by the recipient list.`,
		{ assumeYes: Boolean(gopts.yes), signal: ctx.signal },
	);
	if (!proceed) {
		cancelled();
	}
	const result = await transferRecipientFileOwnership(ctx.adapter, ctx.config, {
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
	const fileId = toRecipientFileId(target);
	const proceed = await confirm(
		`Delete file ${shortId(fileId)}? The Walrus blob is not deleted; it expires on its own lease.`,
		{ assumeYes: Boolean(gopts.yes), signal: ctx.signal },
	);
	if (!proceed) {
		cancelled();
	}
	const result = await deleteRecipientFile(ctx.adapter, ctx.config, {
		fileId,
		signal: ctx.signal,
	});
	ctx.output.result(`Deleted file ${fileId}. (tx: ${result.digest})`, result);
}

export async function runFileRecipientAdd(
	ctx: WriteContext,
	target: string,
	recipient: string,
): Promise<void> {
	const fileId = toRecipientFileId(target);
	const member = toSuiAddress(recipient);
	const result = await addRecipient(ctx.adapter, ctx.config, {
		fileId,
		recipient: member,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Added ${member} to file ${shortId(fileId)}. (tx: ${result.digest})`,
		result,
	);
}

export async function runFileRecipientRemove(
	ctx: WriteContext,
	target: string,
	recipient: string,
): Promise<void> {
	const fileId = toRecipientFileId(target);
	const member = toSuiAddress(recipient);
	const result = await removeRecipient(ctx.adapter, ctx.config, {
		fileId,
		recipient: member,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Removed ${member} from file ${shortId(fileId)}. (tx: ${result.digest})`,
		result,
	);
}

export async function runFileRecipientList(
	ctx: FilesReadContext,
	target: string,
): Promise<void> {
	const file = await ctx.filesReader.getRecipientFile(
		toRecipientFileId(target),
		ctx.signal,
	);
	const human =
		file.members.length === 0 ? "No recipients." : file.members.join("\n");
	ctx.output.result(human, { fileId: file.id, recipients: file.members });
}

interface UploadOptions {
	readonly name: string;
	readonly public?: boolean;
	readonly encrypt?: boolean;
	readonly recipient?: string[];
	readonly contentType?: string;
	readonly epochs?: string;
}

export async function runFileUpload(
	ctx: EncryptContext,
	path: string,
	options: UploadOptions,
): Promise<void> {
	if (options.public && options.encrypt) {
		throw new UsageError("Pass --public or --encrypt, not both.");
	}
	const recipients = (options.recipient ?? []).map((r) => toSuiAddress(r));
	if (options.public && recipients.length > 0) {
		throw new UsageError(
			"--recipient applies to encrypted uploads; a public file is readable by anyone.",
		);
	}
	if (!options.public && !options.encrypt && recipients.length === 0) {
		throw new UsageError(
			"Pass --public for a world-readable file, or --encrypt (optionally with --recipient <addr>).",
		);
	}
	const epochs = parsePositiveInt(options.epochs ?? "3", "--epochs");
	const bytes = await readContentBytes({ file: path });
	const contentType = resolveContentType(options.contentType, path);
	const upload = { epochs, deletable: true };
	const onProgress = uploadProgress(ctx.output);

	if (options.public) {
		const result = await uploadRecipientFileFromBytes(ctx.adapter, ctx.config, {
			walrus: ctx.walrus,
			bytes,
			recipients: [],
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
		return;
	}

	const result = await uploadEncryptedRecipientFileFromBytes(
		ctx.adapter,
		ctx.config,
		{
			walrus: ctx.walrus,
			seal: ctx.seal,
			plaintext: bytes,
			recipients,
			name: options.name,
			contentType,
			upload,
			signal: ctx.signal,
			onProgress,
		},
	);
	const prefixHex = encodeHex(result.sealIdPrefix);
	const nonceHex = encodeHex(result.sealNonce);
	const share = encodeShare(
		result.fileId,
		result.sealIdPrefix,
		result.sealNonce,
	);
	const human = [
		`Uploaded encrypted file ${result.fileId}`,
		`  blobId: ${result.blobId}`,
		`  share:  ${share}`,
		`  tx:     ${result.digest}`,
		"Give the share string to recipients; they need it (plus membership) to decrypt.",
	].join("\n");
	ctx.output.result(human, {
		fileId: result.fileId,
		blobId: result.blobId,
		blobObjectId: result.blobObjectId,
		digest: result.digest,
		gasUsedMist: result.gasUsedMist,
		sealIdPrefix: prefixHex,
		sealNonce: nonceHex,
		share,
	});
}

interface DownloadOptions {
	readonly out?: string;
	readonly share?: string;
	readonly prefix?: string;
	readonly nonce?: string;
	readonly viaAggregator?: boolean;
}

interface DownloadTarget {
	readonly fileId: string;
	readonly decrypt?: {
		readonly prefix: Uint8Array;
		readonly nonce: Uint8Array;
	};
}

function resolveDownloadTarget(
	positional: string | undefined,
	options: DownloadOptions,
): DownloadTarget {
	if (options.share !== undefined) {
		const decoded = decodeShare(options.share);
		if (
			positional !== undefined &&
			String(toRecipientFileId(positional)) !==
				String(toRecipientFileId(decoded.fileId))
		) {
			throw new UsageError(
				"The <file> argument does not match the file id in --share.",
			);
		}
		return {
			fileId: decoded.fileId,
			decrypt: { prefix: decoded.prefix, nonce: decoded.nonce },
		};
	}
	if (positional === undefined) {
		throw new UsageError("Pass a <file> id, or --share <string>.");
	}
	if (options.prefix !== undefined || options.nonce !== undefined) {
		if (options.prefix === undefined || options.nonce === undefined) {
			throw new UsageError(
				"Decrypting needs both --prefix and --nonce (or use --share).",
			);
		}
		return {
			fileId: positional,
			decrypt: {
				prefix: decodeHex(options.prefix),
				nonce: decodeHex(options.nonce),
			},
		};
	}
	return { fileId: positional };
}

async function decryptRecipientFile(
	ctx: FileDownloadContext,
	fileId: ReturnType<typeof toRecipientFileId>,
	ciphertext: Uint8Array,
	prefix: Uint8Array,
	nonce: Uint8Array,
): Promise<Uint8Array> {
	const sealId: SealId = buildRecipientFileSealId(prefix, nonce);
	const { keypair, address } = await ctx.unlockSigner();
	ctx.output.info("Signing a SessionKey with the active account...");
	const sessionKey = await SessionKey.create({
		address,
		packageId: ctx.config.originalPackageId ?? ctx.config.packageId,
		ttlMin: SESSION_KEY_TTL_MIN,
		signer: keypair,
		suiClient: ctx.client,
	});
	return ctx.seal.decryptUnderRecipientFile(ciphertext, {
		sessionKey,
		sealId,
		fileId,
	});
}

export async function runFileDownload(
	ctx: FileDownloadContext,
	positional: string | undefined,
	options: DownloadOptions,
): Promise<void> {
	if (ctx.output.isJson && options.out === undefined) {
		throw new UsageError(
			"Downloading content to stdout is not supported in --json mode; pass --out <path>.",
		);
	}
	const target = resolveDownloadTarget(positional, options);
	const fileId = toRecipientFileId(target.fileId);
	const file = await ctx.filesReader.getRecipientFile(fileId, ctx.signal);
	// A public file has no recipients; any with a recipient list was encrypted.
	// Without a share string (or prefix/nonce) we can only return ciphertext.
	if (target.decrypt === undefined && file.members.length > 0) {
		ctx.output.warn(
			"This file has a recipient list, so its bytes are likely encrypted. Pass --share (or --prefix and --nonce) to decrypt; writing the raw bytes as-is.",
		);
	}
	ctx.output.info("Fetching content from Walrus...");
	const bytes = await ctx.walrusRead.readBlob(file.blobId, {
		signal: ctx.signal,
	});
	let content = bytes;
	if (target.decrypt !== undefined) {
		content = await decryptRecipientFile(
			ctx,
			fileId,
			bytes,
			target.decrypt.prefix,
			target.decrypt.nonce,
		);
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
	let summaries: RecipientFileSummary[];
	if (options.accessible) {
		ctx.output.info("Fetching recipient and file events...");
		const events = await fetchEventStreams(
			ctx.events,
			[
				types.RecipientFileCreated,
				types.RecipientAdded,
				types.RecipientRemoved,
				types.RecipientFileDeleted,
			],
			ctx.signal,
		);
		summaries = reconcileRecipientFilesAccessibleBy(events, address, types);
	} else {
		ctx.output.info("Fetching file events...");
		const events = await fetchEventStreams(
			ctx.events,
			[
				types.RecipientFileCreated,
				types.RecipientFileOwnershipTransferred,
				types.RecipientFileDeleted,
			],
			ctx.signal,
		);
		summaries = reconcileRecipientFilesOwnedBy(events, address, types);
	}
	const limited = limit === undefined ? summaries : summaries.slice(0, limit);
	let items: RecipientFileSummaryOrFull[] = limited;
	if (options.hydrate) {
		ctx.output.info(`Hydrating ${limited.length} file(s)...`);
		const full: RecipientFileSummaryOrFull[] = [];
		for (const summary of limited) {
			const record = await ctx.filesReader.getRecipientFile(
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
		.description("Upload, register, read, list, and manage files on Walrus");

	const upload = file
		.command("upload <path>")
		.description("Encrypt (or not), upload to Walrus, and register a file")
		.requiredOption("-n, --name <name>", "File name")
		.option("--public", "Upload a world-readable (unencrypted) file")
		.option("--encrypt", "Encrypt the file (implied when --recipient is given)")
		.option(
			"--content-type <mime>",
			"MIME content type (inferred from the path if omitted)",
		)
		.option("--epochs <n>", "Walrus storage epochs", "3");
	recipientOption(upload).action(
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
			"List files you can decrypt as a recipient, not just owned",
		)
		.option("--hydrate", "Fetch full records (one read per file)")
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
		.command("download [file]")
		.description("Download a file's content; decrypts in place when encrypted")
		.option("--out <path>", "Write content to a file instead of stdout")
		.option(
			"--share <string>",
			"Share string from upload (bundles file id, prefix, nonce)",
		)
		.option("--prefix <hex>", "Seal prefix (with --nonce) to decrypt")
		.option("--nonce <hex>", "Seal nonce (with --prefix) to decrypt");
	viaAggregatorOption(download).action(
		async (
			target: string | undefined,
			options: DownloadOptions,
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
		.option("--encrypted", "Register an encrypted file (needs --seal-prefix)")
		.option("--seal-prefix <hex>", "Seal prefix the blob was encrypted under")
		.option(
			"--blob-object-id <id>",
			"On-chain Walrus Blob object id, if known",
		);
	recipientOption(register).action(
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
		.description("Transfer a file's ownership (not recipient access)")
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

	const recipient = file
		.command("recipient")
		.description("Manage a file's recipient list");

	recipient
		.command("add <file> <address>")
		.description("Allow an address to decrypt the file")
		.action(
			async (target: string, address: string, _options, command: Command) => {
				await runFileRecipientAdd(
					await buildWriteContext(command),
					target,
					address,
				);
			},
		);

	recipient
		.command("remove <file> <address>")
		.description("Revoke an address's access to the file")
		.action(
			async (target: string, address: string, _options, command: Command) => {
				await runFileRecipientRemove(
					await buildWriteContext(command),
					target,
					address,
				);
			},
		);

	recipient
		.command("list <file>")
		.description("List the file's recipients")
		.action(async (target: string, _options, command: Command) => {
			await runFileRecipientList(await buildFilesReadContext(command), target);
		});
}
