import { beforeEach, describe, expect, test } from "bun:test";
import {
	runCollectionCreate,
	runCollectionDelete,
	runCollectionList,
} from "../src/commands/collection.ts";
import { updateActiveProfile } from "../src/config/active.ts";
import { loadConfig } from "../src/config/store.ts";
import { useTempConfigHome } from "./support/config-home.ts";
import { readContext, writeContext } from "./support/context.ts";
import { ops, resetSdkMock } from "./support/sdk-mock.ts";

useTempConfigHome();
beforeEach(resetSdkMock);

const ID = `0x${"1".repeat(64)}`;

function readerWithCaps(entries: unknown[] = []) {
	return {
		listPublisherCapsOwnedBy: () =>
			Promise.resolve({
				results: [{ id: `0x${"d".repeat(64)}`, publicationId: ID }],
				nextCursor: null,
			}),
		listEntries: () => Promise.resolve({ results: entries, nextCursor: null }),
	} as never;
}

describe("runCollectionList", () => {
	test("renders the publication's collections", async () => {
		const { ctx, captured } = readContext({
			reader: {
				getPublication: () =>
					Promise.resolve({
						id: ID,
						slug: "s",
						name: "n",
						collections: [
							{ name: "posts", storageMode: "blob", nextEntryId: 3 },
						],
					}),
			} as never,
		});
		await runCollectionList(ctx, { publication: ID });
		expect(captured.stdout()).toContain("posts");
		expect(captured.stdout()).toContain("blob");
	});
});

describe("runCollectionCreate", () => {
	test("delegates with the storage mode and selects the collection", async () => {
		// The target must be the active publication for selection to happen;
		// collection names are scoped per publication.
		const { ctx, captured } = writeContext({
			reader: readerWithCaps(),
			settings: { publication: ID },
		});
		await runCollectionCreate(
			ctx,
			"posts",
			{ publication: ID, mode: "quilt" },
			{},
		);
		expect(ops.createCollection).toHaveBeenCalledTimes(1);
		expect(ops.createCollection.mock.calls[0]?.[2]).toMatchObject({
			name: "posts",
			storageMode: "quilt",
		});
		expect(captured.stdout()).toContain("active collection");
		const cfg = await loadConfig();
		expect(cfg.profiles.default?.collection).toBe("posts");
	});

	test("rejects an invalid storage mode before any op", async () => {
		const { ctx } = writeContext({ reader: readerWithCaps() });
		await expect(
			runCollectionCreate(ctx, "posts", { publication: ID, mode: "bogus" }, {}),
		).rejects.toThrow(/--mode/);
		expect(ops.createCollection).not.toHaveBeenCalled();
	});
});

describe("runCollectionDelete", () => {
	test("aborts without --yes in a non-interactive context (empty collection)", async () => {
		// readerWithCaps() reports no entries, so the emptiness check passes and the
		// missing confirmation is what aborts.
		const { ctx } = writeContext({ reader: readerWithCaps() });
		await expect(
			runCollectionDelete(ctx, "posts", { publication: ID }, { yes: false }),
		).rejects.toThrow(/--yes/);
		expect(ops.deleteCollection).not.toHaveBeenCalled();
	});

	test("refuses to delete a non-empty collection before prompting", async () => {
		const { ctx } = writeContext({
			reader: readerWithCaps([{ id: 0, name: "post" }]),
		});
		await expect(
			runCollectionDelete(ctx, "posts", { publication: ID }, { yes: true }),
		).rejects.toThrow(/still has entries/);
		expect(ops.deleteCollection).not.toHaveBeenCalled();
	});

	test("with --yes deletes and clears the active collection when it matches", async () => {
		const { ctx, captured } = writeContext({
			settings: { publication: ID, collection: "posts" },
			reader: readerWithCaps(),
		});
		// Seed a profile so "cleared" is observable rather than vacuously absent.
		await updateActiveProfile({}, { publication: ID, collection: "posts" });
		await runCollectionDelete(ctx, "posts", { publication: ID }, { yes: true });
		expect(ops.deleteCollection).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain('Deleted collection "posts"');
		const cfg = await loadConfig();
		expect(cfg.profiles.default?.collection).toBeUndefined();
	});

	test("does not clear an active collection belonging to another publication", async () => {
		// Collection names are per-publication. Matching on name alone wiped a
		// still-valid selection when a same-named collection was deleted from an
		// unrelated publication.
		const other = `0x${"2".repeat(64)}`;
		const { ctx } = writeContext({
			settings: { publication: other, collection: "posts" },
			reader: readerWithCaps(),
		});
		await updateActiveProfile({}, { publication: other, collection: "posts" });
		await runCollectionDelete(ctx, "posts", { publication: ID }, { yes: true });
		const cfg = await loadConfig();
		expect(cfg.profiles.default?.collection).toBe("posts");
	});

	test("does not select a collection created under a non-active publication", async () => {
		const other = `0x${"2".repeat(64)}`;
		const { ctx, captured } = writeContext({
			settings: { publication: other },
			reader: readerWithCaps(),
		});
		await runCollectionCreate(
			ctx,
			"posts",
			{ publication: ID, mode: "blob" },
			{},
		);
		expect(captured.stdout()).not.toContain("active collection");
		const cfg = await loadConfig();
		expect(cfg.profiles.default?.collection).toBeUndefined();
	});
});
