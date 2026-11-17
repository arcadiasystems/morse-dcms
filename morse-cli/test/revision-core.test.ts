import { beforeEach, describe, expect, test } from "bun:test";
import type { ContentContext } from "../src/cli/context.ts";
import {
	runRevisionAppendDraft,
	runRevisionAppendEncryptedDraft,
	runRevisionPublishDirect,
	runRevisionPublishFromDraft,
} from "../src/commands/revision.ts";
import { useTempFiles } from "./support/content.ts";
import { contentContext, encryptContext } from "./support/context.ts";
import { ops, resetSdkMock } from "./support/sdk-mock.ts";

beforeEach(resetSdkMock);
const files = useTempFiles();

const ID = `0x${"1".repeat(64)}`;
const BLOB = `0x${"7".repeat(64)}`;
const DRAFT_BLOB = `0x${"5".repeat(64)}`;

function revision(over: Record<string, unknown> = {}) {
	return {
		id: 0,
		contentType: "text/plain",
		blobRef: { kind: "blob", blobObjectId: `0x${"9".repeat(64)}` },
		author: `0x${"a".repeat(64)}`,
		encrypted: false,
		sealId: null,
		...over,
	};
}

function entry(revisions: unknown[]) {
	return {
		id: 0,
		name: "post",
		publicHead: 0,
		draftHead: 1,
		revisions,
	};
}

function fixture(entryRevisions: unknown[] = [revision()]) {
	return contentContext({
		reader: {
			listPublisherCapsOwnedBy: () =>
				Promise.resolve({
					results: [{ id: `0x${"d".repeat(64)}`, publicationId: ID }],
					nextCursor: null,
				}),
			getEntry: () => Promise.resolve(entry(entryRevisions)),
		} as never,
		walrus: { uploadBlob: () => Promise.resolve({ blobObjectId: BLOB }) },
	});
}

const baseOptions = {
	publication: ID,
	collection: "posts",
	epochs: "3",
};

describe("runRevisionPublishDirect", () => {
	test("uploads the blob and publishes it as a revision", async () => {
		const file = await files.write("v2.txt", "second version");
		const { ctx, captured } = fixture();
		await runRevisionPublishDirect(ctx, "0", { ...baseOptions, file });
		expect(ops.publishDirect).toHaveBeenCalledTimes(1);
		expect(ops.publishDirect.mock.calls[0]?.[2]).toMatchObject({
			entryId: 0,
			blobObjectId: BLOB,
			collectionName: "posts",
		});
		expect(captured.stdout()).toContain("Published revision #1 on entry #0");
	});

	test("rejects a bad --epochs before uploading", async () => {
		const { ctx } = fixture();
		await expect(
			runRevisionPublishDirect(ctx, "0", {
				...baseOptions,
				epochs: "0",
				stdin: true,
			}),
		).rejects.toThrow(/--epochs/);
		expect(ops.publishDirect).not.toHaveBeenCalled();
	});
});

describe("runRevisionAppendDraft", () => {
	test("appends a draft revision", async () => {
		const file = await files.write("draft.txt", "draft");
		const { ctx, captured } = fixture();
		await runRevisionAppendDraft(ctx, "0", { ...baseOptions, file });
		expect(ops.appendDraftRevision).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain("Appended draft revision #1");
	});
});

describe("runRevisionPublishFromDraft", () => {
	test("uploads new content when --file is given", async () => {
		const file = await files.write("final.txt", "final");
		const { ctx, captured } = fixture();
		await runRevisionPublishFromDraft(ctx, "0", "1", { ...baseOptions, file });
		expect(ops.publishFromDraft).toHaveBeenCalledTimes(1);
		expect(ops.publishFromDraft.mock.calls[0]?.[2]).toMatchObject({
			entryId: 0,
			draftRevisionId: 1,
			blobObjectId: BLOB,
		});
		expect(captured.stdout()).toContain("from draft #1");
	});

	test("reuses the draft's blob when no content is given", async () => {
		const draft = revision({
			id: 1,
			blobRef: { kind: "blob", blobObjectId: DRAFT_BLOB },
		});
		const { ctx, captured } = fixture([revision(), draft]);
		await runRevisionPublishFromDraft(ctx, "0", "1", baseOptions);
		// blobObjectId is the draft's own blob (DRAFT_BLOB), not a fresh upload
		// (which the fixture's uploadBlob would return as BLOB).
		expect(ops.publishFromDraft.mock.calls[0]?.[2]).toMatchObject({
			draftRevisionId: 1,
			blobObjectId: DRAFT_BLOB,
		});
		expect(captured.stdout()).toContain("from draft #1");
	});

	test("errors when the referenced draft id is not found", async () => {
		const { ctx } = fixture([revision()]);
		await expect(
			runRevisionPublishFromDraft(ctx, "0", "9", baseOptions),
		).rejects.toThrow(/no revision #9/);
		expect(ops.publishFromDraft).not.toHaveBeenCalled();
	});
});

describe("mixed entries", () => {
	test("publish-direct appends a public revision on an encrypted entry", async () => {
		const file = await files.write("v.txt", "released");
		const uploaded: Uint8Array[] = [];
		const base = fixture([revision({ encrypted: true })]);
		const ctx = {
			...base.ctx,
			walrus: {
				uploadBlob: (bytes: Uint8Array) => {
					uploaded.push(bytes);
					return Promise.resolve({ blobObjectId: BLOB });
				},
			} as unknown as ContentContext["walrus"],
		};
		await runRevisionPublishDirect(ctx, "0", { ...baseOptions, file });
		expect(ops.publishDirect).toHaveBeenCalledTimes(1);
		expect(ops.publishDirect.mock.calls[0]?.[2]).toMatchObject({
			entryId: 0,
			blobObjectId: BLOB,
		});
		expect(uploaded[0]).toEqual(new TextEncoder().encode("released"));
		expect(base.captured.stdout()).toContain(
			"Published revision #1 on entry #0",
		);
	});

	test("append-draft appends an unencrypted draft on an encrypted entry", async () => {
		const file = await files.write("draft.txt", "soon");
		const { ctx } = fixture([revision({ encrypted: true })]);
		await runRevisionAppendDraft(ctx, "0", { ...baseOptions, file });
		expect(ops.appendDraftRevision).toHaveBeenCalledTimes(1);
	});

	test("publish-from-draft with --file publishes plaintext from an encrypted draft", async () => {
		const file = await files.write("final.txt", "public");
		const draft = revision({
			id: 0,
			encrypted: true,
			blobRef: { kind: "blob", blobObjectId: DRAFT_BLOB },
		});
		const { ctx } = fixture([draft]);
		await runRevisionPublishFromDraft(ctx, "0", "0", { ...baseOptions, file });
		expect(ops.publishFromDraft.mock.calls[0]?.[2]).toMatchObject({
			draftRevisionId: 0,
			blobObjectId: BLOB,
		});
	});

	test("publish-from-draft refuses to reuse an encrypted draft blob", async () => {
		const draft = revision({
			id: 0,
			encrypted: true,
			blobRef: { kind: "blob", blobObjectId: DRAFT_BLOB },
		});
		const { ctx } = fixture([draft]);
		await expect(
			runRevisionPublishFromDraft(ctx, "0", "0", baseOptions),
		).rejects.toThrow(/--file or --stdin/);
		expect(ops.publishFromDraft).not.toHaveBeenCalled();
	});

	test("reuses an unencrypted draft when another revision is encrypted", async () => {
		const encrypted = revision({ id: 0, encrypted: true });
		const draft = revision({
			id: 1,
			blobRef: { kind: "blob", blobObjectId: DRAFT_BLOB },
		});
		const { ctx } = fixture([encrypted, draft]);
		await runRevisionPublishFromDraft(ctx, "0", "1", baseOptions);
		expect(ops.publishFromDraft.mock.calls[0]?.[2]).toMatchObject({
			draftRevisionId: 1,
			blobObjectId: DRAFT_BLOB,
		});
	});
});

describe("runRevisionAppendEncryptedDraft", () => {
	test("encrypts plaintext and appends a draft on a public entry", async () => {
		const file = await files.write("secret.txt", "plaintext");
		const uploaded: Uint8Array[] = [];
		const { ctx, captured } = encryptContext({
			reader: fixture().ctx.reader,
			walrus: {
				uploadBlob: (bytes: Uint8Array) => {
					uploaded.push(bytes);
					return Promise.resolve({ blobObjectId: BLOB });
				},
			},
			seal: {
				encrypt: (plaintext: Uint8Array) =>
					Promise.resolve({
						ciphertext: plaintext.map((byte) => byte ^ 0xff),
					}),
			},
		});
		await runRevisionAppendEncryptedDraft(ctx, "0", { ...baseOptions, file });
		expect(ops.appendEncryptedDraftRevision).toHaveBeenCalledTimes(1);
		const args = ops.appendEncryptedDraftRevision.mock.calls[0]?.[2] as {
			entryId: number;
			blobObjectId: string;
			sealId: Uint8Array;
			contentType: string;
		};
		expect(args.entryId).toBe(0);
		expect(args.blobObjectId).toBe(BLOB);
		expect(args.sealId).toBeInstanceOf(Uint8Array);
		expect(args.sealId.length).toBeGreaterThan(33);
		expect(args.contentType).toBe("text/plain");
		expect(uploaded).toHaveLength(1);
		expect(uploaded[0]).not.toEqual(new TextEncoder().encode("plaintext"));
		expect(ops.appendDraftRevision).not.toHaveBeenCalled();
		expect(ops.publishDirect).not.toHaveBeenCalled();
		expect(captured.stdout()).toContain(
			"Appended encrypted draft revision #1 on entry #0",
		);
	});

	test("does not encrypt or upload when the entry cannot be read", async () => {
		const file = await files.write("secret.txt", "plaintext");
		let encrypted = false;
		let uploaded = false;
		const { ctx } = encryptContext({
			reader: {
				getEntry: () => Promise.reject(new Error("missing entry")),
			} as never,
			walrus: {
				uploadBlob: () => {
					uploaded = true;
					return Promise.resolve({ blobObjectId: BLOB });
				},
			},
			seal: {
				encrypt: () => {
					encrypted = true;
					return Promise.resolve({ ciphertext: new Uint8Array() });
				},
			},
		});
		await expect(
			runRevisionAppendEncryptedDraft(ctx, "0", { ...baseOptions, file }),
		).rejects.toThrow(/missing entry/);
		expect(encrypted).toBe(false);
		expect(uploaded).toBe(false);
		expect(ops.appendEncryptedDraftRevision).not.toHaveBeenCalled();
	});
});
