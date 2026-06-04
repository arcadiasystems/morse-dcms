/** Hex encode/decode for Seal ids, which round-trip through the CLI as `0x` strings. */

import { UsageError } from "../cli/errors.ts";

const HEX = /^[0-9a-fA-F]+$/;

/** Encode bytes as a lowercase `0x`-prefixed hex string. */
export function encodeHex(bytes: Uint8Array): string {
	let out = "0x";
	for (const byte of bytes) {
		out += byte.toString(16).padStart(2, "0");
	}
	return out;
}

/** Decode a hex string (with or without a `0x` prefix) to bytes. */
export function decodeHex(value: string): Uint8Array {
	const body = value.startsWith("0x") ? value.slice(2) : value;
	if (body.length === 0 || body.length % 2 !== 0 || !HEX.test(body)) {
		throw new UsageError(
			`Invalid hex value: expected an even number of hex digits, got ${JSON.stringify(value)}.`,
		);
	}
	const bytes = new Uint8Array(body.length / 2);
	for (let i = 0; i < bytes.length; i += 1) {
		bytes[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}
