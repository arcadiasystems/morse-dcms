import { beforeEach, describe, expect, test } from "bun:test";
import {
	runRevisionAppendDraft,
	runRevisionPublishDirect,
	runRevisionPublishFromDraft,
} from "../src/commands/revision.ts";
import { useTempFiles } from "./support/content.ts";
import { contentContext } from "./support/context.ts";
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

describe("encrypted-entry guard", () => {
	test("publish-direct refuses to append to an encrypted entry", async () => {
		const file = await files.write("v.txt", "content");
		const { ctx } = fixture([revision({ encrypted: true })]);
		await expect(
			runRevisionPublishDirect(ctx, "0", { ...baseOptions, file }),
		).rejects.toThrow(/encrypted/);
		expect(ops.publishDirect).not.toHaveBeenCalled();
	});

	test("append-draft refuses to append to an encrypted entry", async () => {
		const file = await files.write("v.txt", "content");
		const { ctx } = fixture([revision({ encrypted: true })]);
		await expect(
			runRevisionAppendDraft(ctx, "0", { ...baseOptions, file }),
		).rejects.toThrow(/encrypted/);
		expect(ops.appendDraftRevision).not.toHaveBeenCalled();
	});

	test("publish-from-draft refuses to publish on an encrypted entry", async () => {
		const { ctx } = fixture([revision({ encrypted: true })]);
		await expect(
			runRevisionPublishFromDraft(ctx, "0", "1", baseOptions),
		).rejects.toThrow(/encrypted/);
		expect(ops.publishFromDraft).not.toHaveBeenCalled();
	});
});
