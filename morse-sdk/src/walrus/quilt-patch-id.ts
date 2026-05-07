/**
 * Structural codec for the 37-byte Walrus QuiltPatchId. Layout matches
 * `@mysten/walrus`'s BCS schema: `quiltId(32) || version(1) ||
 * startIndex(u16) || endIndex(u16)`. u16s are little-endian (BCS canonical);
 * matching big-endian here would silently corrupt patch IDs.
 *
 * Walrus emits patch IDs as URL-safe base64 (43-byte string). This module
 * decodes that string into structured form and back.
 */

import { toQuiltPatchId, toWalrusBlobId } from "../codecs.js";
import { ValidationError } from "../errors.js";
import {
	QUILT_PATCH_ID_LENGTH,
	type QuiltPatchId,
	type WalrusBlobId,
} from "../types.js";

const QUILT_BLOB_ID_BYTES = 32;
const VERSION_OFFSET = QUILT_BLOB_ID_BYTES;
const START_INDEX_OFFSET = VERSION_OFFSET + 1;
const END_INDEX_OFFSET = START_INDEX_OFFSET + 2;
const MAX_U16 = 0xffff;

/** Default version byte for new patch IDs. Matches Walrus v1. */
export const QUILT_PATCH_ID_VERSION = 1;

/** Structured view of a quilt patch ID. */
export interface QuiltPatchIdParts {
	readonly quiltBlobId: WalrusBlobId;
	readonly version: number;
	readonly startIndex: number;
	readonly endIndex: number;
}

/**
 * Encode structured fields into a 37-byte branded `QuiltPatchId`.
 * @throws {ValidationError} If indices are out of u16 range or version is not u8.
 */
export function encodeQuiltPatchId(parts: QuiltPatchIdParts): QuiltPatchId {
	assertU8(parts.version, "version");
	assertU16(parts.startIndex, "startIndex");
	assertU16(parts.endIndex, "endIndex");
	if (parts.startIndex > parts.endIndex) {
		throw new ValidationError(
			`Invalid sliver range: startIndex (${parts.startIndex}) must not exceed endIndex (${parts.endIndex})`,
			"startIndex",
		);
	}

	const quiltBytes = decodeUrlSafeBase64(parts.quiltBlobId);
	if (quiltBytes.length !== QUILT_BLOB_ID_BYTES) {
		throw new ValidationError(
			`Invalid quiltBlobId: expected ${QUILT_BLOB_ID_BYTES} bytes after decode, got ${quiltBytes.length}`,
			"quiltBlobId",
		);
	}

	const out = new Uint8Array(QUILT_PATCH_ID_LENGTH);
	out.set(quiltBytes, 0);
	out[VERSION_OFFSET] = parts.version;
	const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
	view.setUint16(START_INDEX_OFFSET, parts.startIndex, true);
	view.setUint16(END_INDEX_OFFSET, parts.endIndex, true);
	return toQuiltPatchId(out);
}

/** Decode a branded `QuiltPatchId` back into structured fields. */
export function decodeQuiltPatchId(id: QuiltPatchId): QuiltPatchIdParts {
	const quiltBytes = id.subarray(0, QUILT_BLOB_ID_BYTES);
	const view = new DataView(id.buffer, id.byteOffset, id.byteLength);
	return {
		quiltBlobId: toWalrusBlobId(encodeUrlSafeBase64(quiltBytes)),
		version: id[VERSION_OFFSET] ?? 0,
		startIndex: view.getUint16(START_INDEX_OFFSET, true),
		endIndex: view.getUint16(END_INDEX_OFFSET, true),
	};
}

/**
 * Decode a Walrus-emitted patch ID string (URL-safe base64, 43+ chars) into
 * a branded `QuiltPatchId`. @throws {ValidationError} On wrong byte length.
 */
export function quiltPatchIdFromString(value: string): QuiltPatchId {
	const bytes = decodeUrlSafeBase64(value);
	return toQuiltPatchId(bytes);
}

/** Encode a `QuiltPatchId` to URL-safe base64 (no padding). */
export function quiltPatchIdToString(id: QuiltPatchId): string {
	return encodeUrlSafeBase64(id);
}

function assertU8(value: number, field: string): void {
	if (!Number.isInteger(value) || value < 0 || value > 0xff) {
		throw new ValidationError(
			`Invalid ${field}: expected integer in [0, 255], got ${value}`,
			field,
		);
	}
}

function assertU16(value: number, field: string): void {
	if (!Number.isInteger(value) || value < 0 || value > MAX_U16) {
		throw new ValidationError(
			`Invalid ${field}: expected integer in [0, ${MAX_U16}], got ${value}`,
			field,
		);
	}
}

function decodeUrlSafeBase64(value: string): Uint8Array {
	const standard = value.replace(/-/g, "+").replace(/_/g, "/");
	const padding = (4 - (standard.length % 4)) % 4;
	const padded = standard + "=".repeat(padding);
	let binary: string;
	try {
		binary = atob(padded);
	} catch (cause) {
		throw new ValidationError(
			`Invalid URL-safe base64: ${JSON.stringify(value)}`,
			"value",
			{ cause },
		);
	}
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function encodeUrlSafeBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i] ?? 0);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}
