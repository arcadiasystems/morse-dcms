/**
 * The "morse share string": a single token bundling everything a recipient
 * needs to decrypt a file (fileId, seal prefix, seal nonce). Encrypted uploads
 * emit one; `file download` parses it. Format: `mf1.<b64url(fileId)>.<b64url
 * (prefix)>.<b64url(nonce)>`, so it survives copy-paste and chat without
 * separate flags.
 */

import { UsageError } from "../cli/errors.ts";

const VERSION = "mf1";

export interface SharePayload {
	readonly fileId: string;
	readonly prefix: Uint8Array;
	readonly nonce: Uint8Array;
}

function b64url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url");
}

export function encodeShare(
	fileId: string,
	prefix: Uint8Array,
	nonce: Uint8Array,
): string {
	return [
		VERSION,
		Buffer.from(fileId, "utf8").toString("base64url"),
		b64url(prefix),
		b64url(nonce),
	].join(".");
}

export function decodeShare(value: string): SharePayload {
	const parts = value.split(".");
	if (parts.length !== 4 || parts[0] !== VERSION) {
		throw new UsageError(
			`Invalid share string: expected "${VERSION}.<fileId>.<prefix>.<nonce>".`,
		);
	}
	const fileId = Buffer.from(parts[1] ?? "", "base64url").toString("utf8");
	const prefix = new Uint8Array(Buffer.from(parts[2] ?? "", "base64url"));
	const nonce = new Uint8Array(Buffer.from(parts[3] ?? "", "base64url"));
	if (fileId.length === 0 || prefix.length === 0 || nonce.length === 0) {
		throw new UsageError("Invalid share string: a bundled field was empty.");
	}
	return { fileId, prefix, nonce };
}
