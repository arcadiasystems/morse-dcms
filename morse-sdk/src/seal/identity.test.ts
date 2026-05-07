import { describe, expect, test } from "bun:test";

import { toPublicationId } from "../codecs.js";
import { ValidationError } from "../errors.js";
import { SealPolicyTag } from "../types.js";
import { buildPublisherSealId, decodePublisherSealId } from "./identity.js";

const PUBLICATION_ID = toPublicationId(
	"0x1122334455667788990011223344556677889900112233445566778899001122",
);

describe("buildPublisherSealId", () => {
	test("encodes publication_id then policy_tag then nonce", () => {
		const nonce = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
		const id = buildPublisherSealId(PUBLICATION_ID, nonce);
		expect(id.length).toBe(32 + 1 + 4);
		expect(id[32]).toBe(SealPolicyTag.Publisher);
		expect(Array.from(id.slice(33))).toEqual([0xde, 0xad, 0xbe, 0xef]);
		expect(id[0]).toBe(0x11);
		expect(id[1]).toBe(0x22);
		expect(id[31]).toBe(0x22);
	});

	test("rejects an empty nonce", () => {
		expect(() =>
			buildPublisherSealId(PUBLICATION_ID, new Uint8Array(0)),
		).toThrow(ValidationError);
	});

	test("rejects a publicationId whose hex content is not hex", () => {
		const bogus = "0xZZ" as ReturnType<typeof toPublicationId>;
		expect(() => buildPublisherSealId(bogus, new Uint8Array([1]))).toThrow(
			ValidationError,
		);
	});
});

describe("decodePublisherSealId", () => {
	test("round-trips structured fields", () => {
		const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		const id = buildPublisherSealId(PUBLICATION_ID, nonce);
		const parts = decodePublisherSealId(id);
		expect(parts.publicationId as string).toBe(PUBLICATION_ID as string);
		expect(parts.policyTag).toBe(SealPolicyTag.Publisher);
		expect(Array.from(parts.nonce)).toEqual(Array.from(nonce));
	});

	test("rejects an unknown policy tag byte", () => {
		const id = buildPublisherSealId(PUBLICATION_ID, new Uint8Array([1]));
		const corrupted = new Uint8Array(id);
		corrupted[32] = 99;
		expect(() =>
			decodePublisherSealId(
				corrupted as Uint8Array & { readonly __brand: "SealId" },
			),
		).toThrow(ValidationError);
	});
});
