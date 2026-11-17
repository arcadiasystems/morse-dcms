import { beforeEach, describe, expect, test } from "bun:test";
import type { ContentContext } from "../src/cli/context.ts";
import { CliError } from "../src/cli/errors.ts";
import { ExitCode } from "../src/cli/exit-codes.ts";
import {
	runRevisionAppendDraft,
	runRevisionAppendEncryptedDraft,
	runRevisionPublishDirect,
	runRevisionPublishFromDraft,
} from "../src/commands/revision.ts";
import { useTempFiles } from "./support/content.ts";
import {
	contentContext,
	encryptContext,
	type MockReader,
} from "./support/context.ts";
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

function entry(revisions: unknown[], over: Record<string, unknown> = {}) {
	return {
		id: 0,
		name: "post",
		publicHead: 0,
		draftHead: 1,
		revisions,
		...over,
	};
}

function readerFor(
	entryRevisions: unknown[],
	over: Record<string, unknown> = {},
	readerOver: MockReader = {},
): MockReader {
	return {
		listPublisherCapsOwnedBy: () =>
			Promise.resolve({
				results: [{ id: `0x${"d".repeat(64)}`, publicationId: ID }],
				nextCursor: null,
			}),
		getEntry: () => Promise.resolve(entry(entryRevisions, over) as never),
		getPublication: () =>
			Promise.resolve({
				id: ID,
				collections: [{ name: "posts", storageMode: "blob", nextEntryId: 0 }],
			} as never),
		isPublisherCapRevoked: () => Promise.resolve(false),
		...readerOver,
	} as MockReader;
}

function fixture(
	entryRevisions: unknown[] = [revision()],
	over: Record<string, unknown> = {},
	readerOver: MockReader = {},
) {
	return contentContext({
		reader: readerFor(entryRevisions, over, readerOver),
		walrus: { uploadBlob: () => Promise.resolve({ blobObjectId: BLOB }) },
	});
}

function hexBytes(bytes: Uint8Array): string {
	return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function guardedEncrypt(readerOver: Record<string, unknown>) {
	let encrypted = false;
	let uploaded = false;
	const fixtureReader = readerFor([revision()]);
	const { ctx } = encryptContext({
		reader: { ...fixtureReader, ...readerOver } as MockReader,
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
	return { encrypted: () => encrypted, uploaded: () => uploaded, ctx };
}

function trackingWalrus(uploaded: Uint8Array[]) {
	return {
		uploadBlob: (bytes: Uint8Array) => {
			uploaded.push(bytes);
			return Promise.resolve({ blobObjectId: BLOB });
		},
	} as unknown as ContentContext["walrus"];
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
	test("publish-direct uploads the plaintext, not the encrypted draft blob", async () => {
		const file = await files.write("v.txt", "released");
		const uploaded: Uint8Array[] = [];
		const encryptedBlob = `0x${"4".repeat(64)}`;
		const base = fixture(
			[
				revision({
					encrypted: true,
					blobRef: { kind: "blob", blobObjectId: encryptedBlob },
				}),
			],
			{ publicHead: null },
		);
		const ctx = { ...base.ctx, walrus: trackingWalrus(uploaded) };
		await runRevisionPublishDirect(ctx, "0", { ...baseOptions, file });
		const args = ops.publishDirect.mock.calls[0]?.[2] as {
			blobObjectId: string;
			contentType: string;
		};
		expect(args.blobObjectId).toBe(BLOB);
		expect(args.blobObjectId).not.toBe(encryptedBlob);
		expect(args.contentType).toBe("text/plain");
		expect(uploaded).toEqual([new TextEncoder().encode("released")]);
		expect(base.captured.stdout()).toContain(
			"Published revision #1 on entry #0",
		);
	});

	test("append-draft refuses a team-only entry before uploading", async () => {
		const file = await files.write("draft.txt", "soon");
		const uploaded: Uint8Array[] = [];
		const base = fixture([revision({ encrypted: true })], { publicHead: null });
		const ctx = { ...base.ctx, walrus: trackingWalrus(uploaded) };
		await expect(
			runRevisionAppendDraft(ctx, "0", { ...baseOptions, file }),
		).rejects.toThrow(/--allow-public-blob/);
		expect(uploaded).toHaveLength(0);
		expect(ops.appendDraftRevision).not.toHaveBeenCalled();
	});

	test("append-draft with --allow-public-blob uploads the plaintext", async () => {
		const file = await files.write("draft.txt", "soon");
		const uploaded: Uint8Array[] = [];
		const base = fixture([revision({ encrypted: true })], { publicHead: null });
		const ctx = { ...base.ctx, walrus: trackingWalrus(uploaded) };
		await runRevisionAppendDraft(ctx, "0", {
			...baseOptions,
			file,
			allowPublicBlob: true,
		});
		const args = ops.appendDraftRevision.mock.calls[0]?.[2] as {
			blobObjectId: string;
			contentType: string;
		};
		expect(args.blobObjectId).toBe(BLOB);
		expect(args.contentType).toBe("text/plain");
		expect(uploaded).toEqual([new TextEncoder().encode("soon")]);
	});

	test("append-draft allows plaintext once the entry has a public head", async () => {
		const file = await files.write("draft.txt", "soon");
		const uploaded: Uint8Array[] = [];
		const base = fixture([revision({ encrypted: true }), revision({ id: 1 })], {
			publicHead: 1,
			draftHead: 1,
		});
		const ctx = { ...base.ctx, walrus: trackingWalrus(uploaded) };
		await runRevisionAppendDraft(ctx, "0", { ...baseOptions, file });
		expect(uploaded).toEqual([new TextEncoder().encode("soon")]);
		expect(ops.appendDraftRevision).toHaveBeenCalledTimes(1);
	});

	test("publish-from-draft with --file uploads that plaintext", async () => {
		const file = await files.write("final.txt", "public");
		const uploaded: Uint8Array[] = [];
		const draft = revision({
			id: 0,
			encrypted: true,
			blobRef: { kind: "blob", blobObjectId: DRAFT_BLOB },
		});
		const base = fixture([draft], { publicHead: null });
		const ctx = { ...base.ctx, walrus: trackingWalrus(uploaded) };
		await runRevisionPublishFromDraft(ctx, "0", "0", { ...baseOptions, file });
		const args = ops.publishFromDraft.mock.calls[0]?.[2] as {
			draftRevisionId: number;
			blobObjectId: string;
			contentType: string;
		};
		expect(args.draftRevisionId).toBe(0);
		expect(args.blobObjectId).toBe(BLOB);
		expect(args.blobObjectId).not.toBe(DRAFT_BLOB);
		expect(args.contentType).toBe("text/plain");
		expect(uploaded).toEqual([new TextEncoder().encode("public")]);
	});

	test("publish-from-draft refuses to reuse an encrypted draft blob", async () => {
		const uploaded: Uint8Array[] = [];
		const draft = revision({
			id: 0,
			encrypted: true,
			blobRef: { kind: "blob", blobObjectId: DRAFT_BLOB },
		});
		const base = fixture([draft], { publicHead: null });
		const ctx = { ...base.ctx, walrus: trackingWalrus(uploaded) };
		await expect(
			runRevisionPublishFromDraft(ctx, "0", "0", baseOptions),
		).rejects.toThrow(/ciphertext/);
		expect(uploaded).toHaveLength(0);
		expect(ops.publishFromDraft).not.toHaveBeenCalled();
	});

	test("reuses an unencrypted draft and does not upload", async () => {
		const uploaded: Uint8Array[] = [];
		const encrypted = revision({ id: 0, encrypted: true });
		const draft = revision({
			id: 1,
			contentType: "text/markdown",
			blobRef: { kind: "blob", blobObjectId: DRAFT_BLOB },
		});
		const base = fixture([encrypted, draft]);
		const ctx = { ...base.ctx, walrus: trackingWalrus(uploaded) };
		await runRevisionPublishFromDraft(ctx, "0", "1", baseOptions);
		const args = ops.publishFromDraft.mock.calls[0]?.[2] as {
			draftRevisionId: number;
			blobObjectId: string;
			contentType: string;
		};
		expect(args.draftRevisionId).toBe(1);
		expect(args.blobObjectId).toBe(DRAFT_BLOB);
		expect(args.contentType).toBe("text/markdown");
		expect(uploaded).toHaveLength(0);
	});
});

describe("runRevisionAppendEncryptedDraft", () => {
	test("sends one seal id to Seal and the chain, and uploads the ciphertext", async () => {
		const file = await files.write("secret.txt", "plaintext");
		const uploaded: Uint8Array[] = [];
		let encryptedWith: Uint8Array | undefined;
		const plaintext = new TextEncoder().encode("plaintext");
		const { ctx, captured } = encryptContext({
			json: true,
			reader: fixture().ctx.reader,
			walrus: trackingWalrus(uploaded),
			seal: {
				encrypt: (_bytes: Uint8Array, options: { sealId: Uint8Array }) => {
					encryptedWith = options.sealId;
					return Promise.resolve({
						ciphertext: Uint8Array.from(plaintext, (byte) => byte ^ 0xff),
					});
				},
			},
		});
		await runRevisionAppendEncryptedDraft(ctx, "0", { ...baseOptions, file });
		const args = ops.appendEncryptedDraftRevision.mock.calls[0]?.[2] as {
			entryId: number;
			blobObjectId: string;
			sealId: Uint8Array;
			contentType: string;
		};
		expect(args.entryId).toBe(0);
		expect(args.blobObjectId).toBe(BLOB);
		expect(args.contentType).toBe("text/plain");
		if (encryptedWith === undefined) {
			throw new Error("encrypt was not called");
		}
		expect(args.sealId).toBe(encryptedWith);
		expect(uploaded).toEqual([
			Uint8Array.from(plaintext, (byte) => byte ^ 0xff),
		]);
		expect(uploaded[0]).not.toEqual(plaintext);
		expect(ops.appendDraftRevision).not.toHaveBeenCalled();
		expect(ops.publishDirect).not.toHaveBeenCalled();
		const doc = captured.json() as { sealId: string; revisionId: number };
		expect(doc.revisionId).toBe(1);
		expect(doc.sealId).toBe(hexBytes(args.sealId));
	});

	test("refuses a quilt collection before encrypting or uploading", async () => {
		const file = await files.write("secret.txt", "plaintext");
		const { encrypted, uploaded, ctx } = guardedEncrypt({
			getPublication: () =>
				Promise.resolve({
					id: ID,
					collections: [
						{ name: "posts", storageMode: "quilt", nextEntryId: 0 },
					],
				}),
		});
		await expect(
			runRevisionAppendEncryptedDraft(ctx, "0", { ...baseOptions, file }),
		).rejects.toThrow(/quilt/);
		expect(encrypted()).toBe(false);
		expect(uploaded()).toBe(false);
		expect(ops.appendEncryptedDraftRevision).not.toHaveBeenCalled();
	});

	test("refuses a missing collection before encrypting or uploading", async () => {
		const file = await files.write("secret.txt", "plaintext");
		const { encrypted, uploaded, ctx } = guardedEncrypt({
			getPublication: () => Promise.resolve({ id: ID, collections: [] }),
		});
		await expect(
			runRevisionAppendEncryptedDraft(ctx, "0", { ...baseOptions, file }),
		).rejects.toThrow(/no collection "posts"/);
		expect(encrypted()).toBe(false);
		expect(uploaded()).toBe(false);
		expect(ops.appendEncryptedDraftRevision).not.toHaveBeenCalled();
	});

	test("refuses a revoked cap before encrypting or uploading", async () => {
		const file = await files.write("secret.txt", "plaintext");
		const { encrypted, uploaded, ctx } = guardedEncrypt({
			isPublisherCapRevoked: () => Promise.resolve(true),
		});
		const error = await runRevisionAppendEncryptedDraft(ctx, "0", {
			...baseOptions,
			file,
		}).then(
			() => {
				throw new Error("expected a revoked cap to fail");
			},
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(CliError);
		expect((error as CliError).exitCode).toBe(ExitCode.Auth);
		expect((error as Error).message).toContain("revoked");
		expect(encrypted()).toBe(false);
		expect(uploaded()).toBe(false);
		expect(ops.appendEncryptedDraftRevision).not.toHaveBeenCalled();
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
