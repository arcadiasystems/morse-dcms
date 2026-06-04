import { describe, expect, test } from "bun:test";

import {
	accessPolicyFromU8,
	accessPolicyToU8,
	storageModeFromU8,
	storageModeToU8,
	toBlobObjectId,
	toOwnerCapId,
	toPackageId,
	toPublicationId,
	toPublisherCapId,
	toRecipientFileId,
	toRegistryId,
	toSuiAddress,
	toSuiObjectId,
} from "./codecs.js";
import { ValidationError } from "./errors.js";
import { AccessPolicy, StorageMode } from "./types.js";

const VALID_ID = "0x1";
const VALID_ID_NORMALIZED =
	"0x0000000000000000000000000000000000000000000000000000000000000001";
const VALID_ID_LONG =
	"0xd1dd47c84e7c2f217a8b5a4fcec849a3b985df4fada82f72b72602423d8d018e";

describe("ID constructors", () => {
	const constructors = [
		{ name: "toPackageId", fn: toPackageId, field: "PackageId" },
		{ name: "toRegistryId", fn: toRegistryId, field: "RegistryId" },
		{
			name: "toPublicationId",
			fn: toPublicationId,
			field: "PublicationId",
		},
		{ name: "toOwnerCapId", fn: toOwnerCapId, field: "OwnerCapId" },
		{
			name: "toPublisherCapId",
			fn: toPublisherCapId,
			field: "PublisherCapId",
		},
		{
			name: "toRecipientFileId",
			fn: toRecipientFileId,
			field: "RecipientFileId",
		},
		{ name: "toBlobObjectId", fn: toBlobObjectId, field: "BlobObjectId" },
		{ name: "toSuiAddress", fn: toSuiAddress, field: "SuiAddress" },
		{ name: "toSuiObjectId", fn: toSuiObjectId, field: "SuiObjectId" },
	];

	for (const { name, fn, field } of constructors) {
		test(`${name} normalizes a short valid object id to 64 hex chars`, () => {
			expect(fn(VALID_ID) as string).toBe(VALID_ID_NORMALIZED);
		});

		test(`${name} accepts a full 32-byte object id`, () => {
			expect(fn(VALID_ID_LONG) as string).toBe(VALID_ID_LONG);
		});

		test(`${name} rejects missing 0x prefix`, () => {
			expect(() => fn("1234")).toThrow(ValidationError);
		});

		test(`${name} rejects uppercase hex`, () => {
			expect(() => fn("0xABCD")).toThrow(ValidationError);
		});

		test(`${name} rejects non-hex characters`, () => {
			expect(() => fn("0xzzz")).toThrow(ValidationError);
		});

		test(`${name} rejects an empty string`, () => {
			expect(() => fn("")).toThrow(ValidationError);
		});

		test(`${name} rejects an overlong hex string`, () => {
			const overlong = `0x${"a".repeat(65)}`;
			expect(() => fn(overlong)).toThrow(ValidationError);
		});

		test(`${name} error carries its field name`, () => {
			try {
				fn("not-hex");
				throw new Error("expected throw");
			} catch (error) {
				expect(error).toBeInstanceOf(ValidationError);
				expect((error as ValidationError).field).toBe(field);
			}
		});
	}
});

describe("storage mode codec", () => {
	test("storageModeToU8 maps blob to 0 and quilt to 1", () => {
		expect(storageModeToU8(StorageMode.Blob)).toBe(0);
		expect(storageModeToU8(StorageMode.Quilt)).toBe(1);
	});

	test("storageModeFromU8 maps 0 to blob and 1 to quilt", () => {
		expect(storageModeFromU8(0)).toBe(StorageMode.Blob);
		expect(storageModeFromU8(1)).toBe(StorageMode.Quilt);
	});

	test("storageModeFromU8 rejects unknown values", () => {
		expect(() => storageModeFromU8(2)).toThrow(ValidationError);
		expect(() => storageModeFromU8(-1)).toThrow(ValidationError);
	});

	test("round-trips u8 through string and back", () => {
		for (const raw of [0, 1]) {
			expect(storageModeToU8(storageModeFromU8(raw))).toBe(raw);
		}
	});
});

describe("access policy codec", () => {
	test("accessPolicyToU8 maps each variant correctly", () => {
		expect(accessPolicyToU8(AccessPolicy.Public)).toBe(0);
		expect(accessPolicyToU8(AccessPolicy.Publisher)).toBe(1);
		expect(accessPolicyToU8(AccessPolicy.Subscription)).toBe(2);
	});

	test("accessPolicyFromU8 maps each variant correctly", () => {
		expect(accessPolicyFromU8(0)).toBe(AccessPolicy.Public);
		expect(accessPolicyFromU8(1)).toBe(AccessPolicy.Publisher);
		expect(accessPolicyFromU8(2)).toBe(AccessPolicy.Subscription);
	});

	test("accessPolicyFromU8 rejects unknown values", () => {
		expect(() => accessPolicyFromU8(3)).toThrow(ValidationError);
		expect(() => accessPolicyFromU8(255)).toThrow(ValidationError);
	});

	test("round-trips u8 through string and back", () => {
		for (const raw of [0, 1, 2]) {
			expect(accessPolicyToU8(accessPolicyFromU8(raw))).toBe(raw);
		}
	});
});
