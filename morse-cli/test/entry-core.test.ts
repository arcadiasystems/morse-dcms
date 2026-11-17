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

function publicationWith(collections: unknown[]) {
	return { id: ID, slug: "s", name: "n", collections };
}

function publisherCapReader(
	collections: unknown[] = [
		{ name: "posts", storageMode: "blob", nextEntryId: 0 },
	],
) {
	return {
		listPublisherCapsOwnedBy: () =>
			Promise.resolve({
				results: [{ id: `0x${"d".repeat(64)}`, publicationId: ID }],
				nextCursor: null,
			}),
		getPublication: () => Promise.resolve(publicationWith(collections)),
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
		expect(captured.stdout()).toContain("revisions:");
	});

	test("renders a mixed entry's public head and encrypted revision", async () => {
		const { ctx, captured } = readContext({
			reader: {
				getEntry: () =>
					Promise.resolve({
						...entry([
							revision({ encrypted: true, sealId: new Uint8Array([1]) }),
							revision({ id: 1 }),
						]),
						draftHead: 0,
						publicHead: 1,
					}),
			} as never,
		});
		await runEntryGet(ctx, "0", { publication: ID, collection: "posts" });
		const lines = captured.stdout().split("\n");
		expect(captured.stdout()).toContain("publicHead:   1");
		expect(lines.find((line) => line.includes("[0]"))).toContain("encrypted");
		expect(lines.find((line) => line.includes("[1]"))).not.toContain(
			"encrypted",
		);
	});

	test("rejects a non-numeric entry id", async () => {
		const { ctx } = readContext({ reader: {} as never });
		await expect(
			runEntryGet(ctx, "abc", { publication: ID, collection: "posts" }),
		).rejects.toThrow(/entryId/);
	});
});

describe("runEntryList / runEntryScan", () => {
	test("list marks a newer encrypted draft and not a released public head", async () => {
		const pending = {
			...entry([
				revision(),
				revision({ id: 1, encrypted: true, sealId: new Uint8Array([1]) }),
			]),
			id: 3,
			name: "pending",
			draftHead: 1,
			publicHead: 0,
		};
		const released = {
			...entry([
				revision({ encrypted: true, sealId: new Uint8Array([1]) }),
				revision({ id: 1 }),
			]),
			id: 2,
			name: "released",
			draftHead: 0,
			publicHead: 1,
		};
		const { ctx, captured } = readContext({
			reader: {
				listEntries: () =>
					Promise.resolve({
						results: [released, pending],
						nextCursor: null,
					}),
			} as never,
		});
		await runEntryList(ctx, { publication: ID, collection: "posts" });
		const out = captured.stdout();
		expect(out).toContain("#2 released (2 revisions)");
		expect(out).not.toContain("#2 released (2 revisions) [draft]");
		expect(out).toContain("#3 pending (2 revisions) [draft]");
	});

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

	test("list --all takes the scan path, not a single page", async () => {
		// `scan` is the auto-paginated form but nobody guesses the name, so --all
		// is the discoverable spelling of the same behaviour.
		const { ctx, captured } = readContext({
			reader: {
				scanEntries: async function* () {
					yield entry([revision()]);
					yield { ...entry([]), id: 1, name: "second" };
				},
			} as never,
		});
		await runEntryList(ctx, {
			publication: ID,
			collection: "posts",
			all: true,
		});
		expect(captured.stdout()).toContain("#0 post");
		expect(captured.stdout()).toContain("#1 second");
	});

	test("list --all refuses paging flags that contradict it", async () => {
		const { ctx } = readContext();
		await expect(
			runEntryList(ctx, {
				publication: ID,
				collection: "posts",
				all: true,
				limit: "2",
			}),
		).rejects.toThrow(/--all cannot be combined/);
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

	test("refuses a missing collection without uploading", async () => {
		const file = await files.write("post.md", "# hello");
		const { ctx } = contentContext({ reader: publisherCapReader([]) });
		await expect(
			runEntryAdd(ctx, "post", {
				publication: ID,
				collection: "posts",
				epochs: "3",
				file,
			}),
		).rejects.toThrow(/no collection "posts"/);
		expect(ops.addEntryFromBytes).not.toHaveBeenCalled();
	});

	test("refuses a quilt collection without uploading", async () => {
		const file = await files.write("post.md", "# hello");
		const { ctx } = contentContext({
			reader: publisherCapReader([
				{ name: "posts", storageMode: "quilt", nextEntryId: 0 },
			]),
		});
		await expect(
			runEntryAdd(ctx, "post", {
				publication: ID,
				collection: "posts",
				epochs: "3",
				file,
			}),
		).rejects.toThrow(/quilt/);
		expect(ops.addEntryFromBytes).not.toHaveBeenCalled();
	});
});

describe("runEntryList --drafts-only", () => {
	test("keeps only entries with a pending draft", async () => {
		const pending = {
			...entry([revision()]),
			id: 2,
			draftHead: 1,
			publicHead: 0,
		};
		const published = { ...entry([revision()]), id: 3, draftHead: null };
		const { ctx, captured } = readContext({
			reader: {
				listEntries: () =>
					Promise.resolve({ results: [pending, published], nextCursor: null }),
			} as never,
		});
		await runEntryList(ctx, {
			publication: ID,
			collection: "posts",
			draftsOnly: true,
		});
		expect(captured.stdout()).toContain("#2");
		expect(captured.stdout()).not.toContain("#3");
	});

	test("scan --drafts-only excludes published entries", async () => {
		const pending = {
			...entry([revision()]),
			id: 4,
			draftHead: 1,
			publicHead: 0,
		};
		const published = { ...entry([revision()]), id: 5, draftHead: null };
		const { ctx, captured } = readContext({
			reader: {
				scanEntries: async function* () {
					yield pending;
					yield published;
				},
			} as never,
		});
		await runEntryScan(ctx, {
			publication: ID,
			collection: "posts",
			draftsOnly: true,
		});
		expect(captured.stdout()).toContain("#4");
		expect(captured.stdout()).not.toContain("#5");
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

	test("refuses an encrypted revision and does not fetch it", async () => {
		let fetched = false;
		const { ctx } = readContentContext({
			reader: {
				getEntry: () =>
					Promise.resolve({
						...entry([revision({ encrypted: true })]),
						publicHead: null,
						draftHead: 0,
					}),
			} as never,
			walrusRead: {
				readBlobRef: () => {
					fetched = true;
					return Promise.resolve(new Uint8Array());
				},
			},
		});
		await expect(
			runEntryRead(ctx, "0", undefined, {
				publication: ID,
				collection: "posts",
			}),
		).rejects.toThrow(/morse entry decrypt 0 0/);
		expect(fetched).toBe(false);
	});

	test("names the plaintext draft when a missing public head is mixed", async () => {
		let fetched = false;
		const { ctx } = readContentContext({
			reader: {
				getEntry: () =>
					Promise.resolve({
						...entry([
							revision({ encrypted: true, sealId: new Uint8Array([1]) }),
							revision({ id: 1 }),
						]),
						publicHead: null,
						draftHead: 1,
					}),
			} as never,
			walrusRead: {
				readBlobRef: () => {
					fetched = true;
					return Promise.resolve(new Uint8Array());
				},
			},
		});
		await expect(
			runEntryRead(ctx, "0", undefined, {
				publication: ID,
				collection: "posts",
			}),
		).rejects.toThrow(/morse entry read 0 1.*morse entry decrypt 0 0/);
		expect(fetched).toBe(false);
	});

	test("serves the public head when a later revision is encrypted", async () => {
		const publicBlob = `0x${"1".repeat(64)}`;
		const secretBlob = `0x${"2".repeat(64)}`;
		const out = files.path("public.txt");
		const { ctx } = readContentContext({
			reader: {
				getEntry: () =>
					Promise.resolve({
						...entry([
							revision({
								blobRef: { kind: "blob", blobObjectId: publicBlob },
							}),
							revision({
								id: 1,
								encrypted: true,
								sealId: new Uint8Array([1]),
								blobRef: { kind: "blob", blobObjectId: secretBlob },
							}),
						]),
						publicHead: 0,
						draftHead: 1,
					}),
			} as never,
			walrusRead: {
				readBlobRef: (ref: { blobObjectId: string }) =>
					Promise.resolve(
						new TextEncoder().encode(
							ref.blobObjectId === secretBlob ? "CIPHERTEXT" : "public body",
						),
					),
			},
		});
		await runEntryRead(ctx, "0", undefined, {
			publication: ID,
			collection: "posts",
			out,
		});
		expect(await readFile(out, "utf8")).toBe("public body");
	});

	test("serves the public head when an earlier revision is encrypted", async () => {
		const secretBlob = `0x${"2".repeat(64)}`;
		const publicBlob = `0x${"3".repeat(64)}`;
		const out = files.path("released.txt");
		const { ctx } = readContentContext({
			reader: {
				getEntry: () =>
					Promise.resolve({
						...entry([
							revision({
								encrypted: true,
								sealId: new Uint8Array([1]),
								blobRef: { kind: "blob", blobObjectId: secretBlob },
							}),
							revision({
								id: 1,
								blobRef: { kind: "blob", blobObjectId: publicBlob },
							}),
						]),
						publicHead: 1,
						draftHead: 0,
					}),
			} as never,
			walrusRead: {
				readBlobRef: (ref: { blobObjectId: string }) =>
					Promise.resolve(
						new TextEncoder().encode(
							ref.blobObjectId === publicBlob ? "released" : "CIPHERTEXT",
						),
					),
			},
		});
		await runEntryRead(ctx, "0", undefined, {
			publication: ID,
			collection: "posts",
			out,
		});
		expect(await readFile(out, "utf8")).toBe("released");
	});

	test("refuses an explicit encrypted index without fetching it", async () => {
		let fetched = false;
		const { ctx } = readContentContext({
			reader: {
				getEntry: () =>
					Promise.resolve({
						...entry([
							revision(),
							revision({ id: 1, encrypted: true, sealId: new Uint8Array([1]) }),
						]),
						publicHead: 0,
						draftHead: 1,
					}),
			} as never,
			walrusRead: {
				readBlobRef: () => {
					fetched = true;
					return Promise.resolve(new Uint8Array());
				},
			},
		});
		await expect(
			runEntryRead(ctx, "0", "1", {
				publication: ID,
				collection: "posts",
			}),
		).rejects.toThrow(/encrypted/);
		expect(fetched).toBe(false);
	});

	test("errors when the public head does not match a revision", async () => {
		const { ctx } = readContentContext({
			reader: {
				getEntry: () =>
					Promise.resolve({ ...entry([revision()]), publicHead: 4 }),
			} as never,
		});
		await expect(
			runEntryRead(ctx, "0", undefined, {
				publication: ID,
				collection: "posts",
			}),
		).rejects.toThrow(/public head #4/);
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
