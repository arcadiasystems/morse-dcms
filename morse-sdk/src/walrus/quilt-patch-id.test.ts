import { describe, expect, test } from "bun:test";

import { ValidationError } from "../errors.js";
import { QUILT_PATCH_ID_LENGTH, type WalrusBlobId } from "../types.js";
import {
	decodeQuiltPatchId,
	encodeQuiltPatchId,
	QUILT_PATCH_ID_VERSION,
	quiltPatchIdFromString,
	quiltPatchIdToString,
} from "./quilt-patch-id.js";

const SAMPLE_BLOB_ID =
	"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as WalrusBlobId;
const NONZERO_BLOB_ID =
	"R28U_uoR3qFZD2vEgPJpHmuIcr-fzs9LRVR9OzlH9bI" as WalrusBlobId;

describe("encodeQuiltPatchId", () => {
	test("produces 37 bytes for valid input", () => {
		const id = encodeQuiltPatchId({
			quiltBlobId: SAMPLE_BLOB_ID,
			version: QUILT_PATCH_ID_VERSION,
			startIndex: 0,
			endIndex: 0,
		});
		expect(id.length).toBe(QUILT_PATCH_ID_LENGTH);
	});

	test("encodes u16 indices little-endian", () => {
		const id = encodeQuiltPatchId({
			quiltBlobId: SAMPLE_BLOB_ID,
			version: QUILT_PATCH_ID_VERSION,
			startIndex: 0x0102,
			endIndex: 0x0304,
		});
		expect(id[33]).toBe(0x02);
		expect(id[34]).toBe(0x01);
		expect(id[35]).toBe(0x04);
		expect(id[36]).toBe(0x03);
	});

	test("places version at byte 32", () => {
		const id = encodeQuiltPatchId({
			quiltBlobId: SAMPLE_BLOB_ID,
			version: 7,
			startIndex: 0,
			endIndex: 0,
		});
		expect(id[32]).toBe(7);
	});

	test.each([
		["startIndex", { startIndex: -1, endIndex: 0 }],
		["startIndex too big", { startIndex: 0x10000, endIndex: 0 }],
		["endIndex", { startIndex: 0, endIndex: -1 }],
		["endIndex too big", { startIndex: 0, endIndex: 0x10000 }],
	])("rejects out-of-range %s", (_label, overrides) => {
		expect(() =>
			encodeQuiltPatchId({
				quiltBlobId: SAMPLE_BLOB_ID,
				version: QUILT_PATCH_ID_VERSION,
				...overrides,
			}),
		).toThrow(ValidationError);
	});

	test("rejects non-integer index", () => {
		expect(() =>
			encodeQuiltPatchId({
				quiltBlobId: SAMPLE_BLOB_ID,
				version: QUILT_PATCH_ID_VERSION,
				startIndex: 1.5,
				endIndex: 0,
			}),
		).toThrow(ValidationError);
	});

	test("rejects startIndex > endIndex", () => {
		expect(() =>
			encodeQuiltPatchId({
				quiltBlobId: SAMPLE_BLOB_ID,
				version: QUILT_PATCH_ID_VERSION,
				startIndex: 10,
				endIndex: 5,
			}),
		).toThrow(ValidationError);
	});

	test("rejects out-of-range version", () => {
		expect(() =>
			encodeQuiltPatchId({
				quiltBlobId: SAMPLE_BLOB_ID,
				version: 256,
				startIndex: 0,
				endIndex: 0,
			}),
		).toThrow(ValidationError);
	});
});

describe("decodeQuiltPatchId", () => {
	test("round-trips structured input across the index range", () => {
		const cases = [
			{ startIndex: 0, endIndex: 0 },
			{ startIndex: 1, endIndex: 1 },
			{ startIndex: 0xff, endIndex: 0x100 },
			{ startIndex: 0xfffe, endIndex: 0xffff },
		];
		for (const c of cases) {
			const id = encodeQuiltPatchId({
				quiltBlobId: NONZERO_BLOB_ID,
				version: QUILT_PATCH_ID_VERSION,
				...c,
			});
			const parts = decodeQuiltPatchId(id);
			expect(parts.startIndex).toBe(c.startIndex);
			expect(parts.endIndex).toBe(c.endIndex);
			expect(parts.version).toBe(QUILT_PATCH_ID_VERSION);
			expect(parts.quiltBlobId).toBe(NONZERO_BLOB_ID);
		}
	});

	test("preserves the version byte", () => {
		const id = encodeQuiltPatchId({
			quiltBlobId: NONZERO_BLOB_ID,
			version: 42,
			startIndex: 0,
			endIndex: 0,
		});
		expect(decodeQuiltPatchId(id).version).toBe(42);
	});
});

describe("quiltPatchIdFromString / quiltPatchIdToString", () => {
	test("round-trips through URL-safe base64", () => {
		const id = encodeQuiltPatchId({
			quiltBlobId: NONZERO_BLOB_ID,
			version: QUILT_PATCH_ID_VERSION,
			startIndex: 5,
			endIndex: 9,
		});
		const str = quiltPatchIdToString(id);
		expect(str).not.toContain("+");
		expect(str).not.toContain("/");
		expect(str).not.toContain("=");
		const decoded = quiltPatchIdFromString(str);
		expect(decoded).toEqual(id);
	});

	test("rejects strings whose decoded length is not 37", () => {
		expect(() => quiltPatchIdFromString("AAAA")).toThrow(ValidationError);
	});

	test("rejects malformed base64", () => {
		expect(() => quiltPatchIdFromString("!!!not base64!!!")).toThrow(
			ValidationError,
		);
	});
});
