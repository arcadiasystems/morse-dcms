import { beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
	runEntryAdd,
	runEntryDelete,
	runEntryGet,
	runEntryList,
	runEntryRead,
	runEntryScan,
} from "../src/commands/entry.ts";
import { useTempFiles } from "./support/content.ts";
import {
	contentContext,
	readContentContext,
	readContext,
	writeContext,
} from "./support/context.ts";
import { ops, resetSdkMock } from "./support/sdk-mock.ts";

beforeEach(resetSdkMock);
const files = useTempFiles();

const ID = `0x${"1".repeat(64)}`;
const AUTHOR = `0x${"a".repeat(64)}`;

function revision(over: Record<string, unknown> = {}) {
	return {
		id: 0,
		contentType: "text/plain",
		blobRef: { kind: "blob", blobObjectId: `0x${"9".repeat(64)}` },
		author: AUTHOR,
		encrypted: false,
		sealId: null,
		...over,
	};
}

function entry(revisions: unknown[]) {
	return {
		id: 0,
		name: "post",
		publicHead: revisions.length > 0 ? 0 : null,
		draftHead: null,
		revisions,
	};
}

function publisherCapReader() {
	return {
		listPublisherCapsOwnedBy: () =>
			Promise.resolve({
				results: [{ id: `0x${"d".repeat(64)}`, publicationId: ID }],
				nextCursor: null,
			}),
	} as never;
}

describe("runEntryGet", () => {
	test("renders the entry with its revisions", async () => {
		const { ctx, captured } = readContext({
			reader: {
				getEntry: () => Promise.resolve(entry([revision()])),
			} as never,
		});
		await runEntryGet(ctx, "0", { publication: ID, collection: "posts" });
		expect(captured.stdout()).toContain("#0 post");
		expect(captured.stdout()).toContain("revisions:  1");
	});

	test("rejects a non-numeric entry id", async () => {
		const { ctx } = readContext({ reader: {} as never });
		await expect(
			runEntryGet(ctx, "abc", { publication: ID, collection: "posts" }),
		).rejects.toThrow(/entryId/);
	});
});

describe("runEntryList / runEntryScan", () => {
	test("list renders entries", async () => {
		const { ctx, captured } = readContext({
			reader: {
				listEntries: () =>
					Promise.resolve({ results: [entry([revision()])], nextCursor: null }),
			} as never,
		});
		await runEntryList(ctx, { publication: ID, collection: "posts" });
		expect(captured.stdout()).toContain("#0 post (1 revisions)");
	});

	test("scan drains the async iterator", async () => {
		const { ctx, captured } = readContext({
			reader: {
				scanEntries: async function* () {
					yield entry([revision()]);
					yield { ...entry([]), id: 1, name: "second" };
				},
			} as never,
		});
		await runEntryScan(ctx, { publication: ID, collection: "posts" });
		expect(captured.stdout()).toContain("#0 post");
		expect(captured.stdout()).toContain("#1 second");
	});
});

describe("runEntryAdd", () => {
	test("uploads file bytes and delegates with the epochs and content type", async () => {
		const file = await files.write("post.md", "# hello");
		const { ctx, captured } = contentContext({ reader: publisherCapReader() });
		await runEntryAdd(ctx, "post", {
			publication: ID,
			collection: "posts",
			epochs: "5",
			file,
		});
		expect(ops.addEntryFromBytes).toHaveBeenCalledTimes(1);
		expect(ops.addEntryFromBytes.mock.calls[0]?.[2]).toMatchObject({
			name: "post",
			collectionName: "posts",
			contentType: "text/markdown",
			upload: { epochs: 5, deletable: true },
		});
		expect(captured.stdout()).toContain("Added entry #0");
		expect(captured.stdout()).toContain("view:");
	});

	test("rejects a non-positive --epochs before any upload", async () => {
		const { ctx } = contentContext({ reader: publisherCapReader() });
		await expect(
			runEntryAdd(ctx, "post", {
				publication: ID,
				collection: "posts",
				epochs: "0",
				stdin: true,
			}),
		).rejects.toThrow(/--epochs/);
		expect(ops.addEntryFromBytes).not.toHaveBeenCalled();
	});
});

describe("runEntryDelete", () => {
	test("aborts without --yes", async () => {
		const { ctx } = writeContext({ reader: publisherCapReader() });
		await expect(
			runEntryDelete(ctx, "0", { publication: ID, collection: "posts" }, {}),
		).rejects.toThrow(/--yes/);
		expect(ops.deleteEntry).not.toHaveBeenCalled();
	});

	test("with --yes resolves the publisher cap and deletes", async () => {
		const { ctx, captured } = writeContext({ reader: publisherCapReader() });
		await runEntryDelete(
			ctx,
			"0",
			{ publication: ID, collection: "posts" },
			{ yes: true },
		);
		expect(ops.deleteEntry).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain("Deleted entry #0");
	});
});

describe("runEntryRead", () => {
	test("--json without --out is a usage error", async () => {
		const { ctx } = readContentContext({ json: true, reader: {} as never });
		await expect(
			runEntryRead(ctx, "0", undefined, {
				publication: ID,
				collection: "posts",
			}),
		).rejects.toThrow(/--out/);
	});

	test("errors when the entry has no revisions", async () => {
		const { ctx } = readContentContext({
			reader: { getEntry: () => Promise.resolve(entry([])) } as never,
		});
		await expect(
			runEntryRead(ctx, "0", undefined, {
				publication: ID,
				collection: "posts",
			}),
		).rejects.toThrow(/no revisions/);
	});

	test("refuses an encrypted revision", async () => {
		const { ctx } = readContentContext({
			reader: {
				getEntry: () => Promise.resolve(entry([revision({ encrypted: true })])),
			} as never,
		});
		await expect(
			runEntryRead(ctx, "0", undefined, {
				publication: ID,
				collection: "posts",
			}),
		).rejects.toThrow(/encrypted/);
	});

	test("writes fetched bytes to --out", async () => {
		const out = files.path("out.bin");
		const { ctx, captured } = readContentContext({
			reader: {
				getEntry: () => Promise.resolve(entry([revision()])),
			} as never,
			walrusRead: {
				readBlobRef: () => Promise.resolve(new TextEncoder().encode("payload")),
			},
		});
		await runEntryRead(ctx, "0", undefined, {
			publication: ID,
			collection: "posts",
			out,
		});
		expect(captured.stdout()).toContain(`Wrote 7 bytes to ${out}`);
		expect(await readFile(out, "utf8")).toBe("payload");
	});
});
