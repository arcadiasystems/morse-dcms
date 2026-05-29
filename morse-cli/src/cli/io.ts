/**
 * Cross-runtime file and stdin helpers over `node:fs/promises`, so the CLI runs
 * under both Node and Bun. The keystore crypto path stays on `node:crypto` for
 * the same reason; this module covers the remaining file/stdin IO.
 */

import { access, readFile, writeFile } from "node:fs/promises";

export async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function readBytes(path: string): Promise<Uint8Array> {
	return new Uint8Array(await readFile(path));
}

export async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

export async function writeFileContents(
	path: string,
	data: string | Uint8Array,
): Promise<void> {
	await writeFile(path, data);
}

/** Read all of stdin as bytes. Used for `--stdin` / `--file -`. */
export async function readStdin(): Promise<Uint8Array> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk as Buffer);
	}
	return new Uint8Array(Buffer.concat(chunks));
}
