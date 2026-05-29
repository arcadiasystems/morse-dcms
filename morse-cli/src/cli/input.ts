/** Read content bytes from a file or stdin, and infer a content type. */

import { extname } from "node:path";

import { UsageError } from "./errors.ts";
import { fileExists, readBytes, readStdin } from "./io.ts";

export interface ContentInputOptions {
	readonly file?: string;
	readonly stdin?: boolean;
}

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
	".txt": "text/plain",
	".md": "text/markdown",
	".html": "text/html",
	".json": "application/json",
	".csv": "text/csv",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".pdf": "application/pdf",
};

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * Read bytes from `--file <path>`, or from stdin when `--stdin` is set or the
 * file path is `-`. Throws a `UsageError` when no source is given or the file
 * is missing.
 */
export async function readContentBytes(
	options: ContentInputOptions,
): Promise<Uint8Array> {
	const bytes = await readRaw(options);
	if (bytes.length === 0) {
		throw new UsageError("Content is empty; nothing to upload.");
	}
	return bytes;
}

async function readRaw(options: ContentInputOptions): Promise<Uint8Array> {
	if (options.stdin || options.file === "-") {
		return readStdin();
	}
	if (options.file === undefined) {
		throw new UsageError("Provide content with --file <path> or --stdin.");
	}
	if (!(await fileExists(options.file))) {
		throw new UsageError(`File not found: ${options.file}`);
	}
	return readBytes(options.file);
}

/**
 * Resolve the content type: the explicit flag wins; otherwise infer from the
 * file extension; otherwise fall back to `application/octet-stream`.
 */
export function resolveContentType(
	explicit: string | undefined,
	file: string | undefined,
): string {
	if (explicit !== undefined) {
		return explicit;
	}
	if (file !== undefined && file !== "-") {
		const type = EXTENSION_TYPES[extname(file).toLowerCase()];
		if (type !== undefined) {
			return type;
		}
	}
	return DEFAULT_CONTENT_TYPE;
}
