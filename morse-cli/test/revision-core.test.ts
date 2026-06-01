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

function fixture() {
	return contentContext({
		reader: {
			listPublisherCapsOwnedBy: () =>
				Promise.resolve({
					results: [{ id: `0x${"d".repeat(64)}`, publicationId: ID }],
					nextCursor: null,
				}),
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
	test("publishes referencing the draft id", async () => {
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
});
