import { describe, expect, test } from "bun:test";

import { resolveCollection, resolvePublication } from "../src/cli/target.ts";
import { type MockReader, readContext } from "./support/context.ts";

const ID = `0x${"1".repeat(64)}`;

function readerWith(
	publications: Array<{ id: string; slug: string; name: string }>,
): MockReader {
	const owned = publications.map((p) => ({
		publicationId: p.id,
		ownerCapId: `0x${"c".repeat(64)}`,
	}));
	return {
		listPublicationsOwnedBy: () =>
			Promise.resolve({ results: owned, nextCursor: null }),
		getPublication: (id: string) => {
			const match = publications.find((p) => p.id === id);
			return Promise.resolve({ ...match, collections: [] });
		},
	} as unknown as MockReader;
}

describe("resolvePublication", () => {
	test("returns an object id verbatim (lowercased)", async () => {
		const { ctx } = readContext();
		const mixed = `0x${"A".repeat(64)}`;
		const resolved = await resolvePublication(ctx, mixed);
		expect(String(resolved)).toBe(`0x${"a".repeat(64)}`);
	});

	test("falls back to the active publication when no override", async () => {
		const { ctx } = readContext({ settings: { publication: ID } });
		expect(String(await resolvePublication(ctx, undefined))).toBe(ID);
	});

	test("throws a usage error when nothing is selected", async () => {
		const { ctx } = readContext();
		await expect(resolvePublication(ctx, undefined)).rejects.toThrow(
			/No publication selected/,
		);
	});

	test("resolves a slug among owned publications", async () => {
		const target = { id: ID, slug: "my-blog", name: "Blog" };
		const { ctx } = readContext({ reader: readerWith([target]) });
		expect(String(await resolvePublication(ctx, "my-blog"))).toBe(ID);
	});

	test("throws when no owned publication matches the slug", async () => {
		const { ctx } = readContext({
			reader: readerWith([{ id: ID, slug: "other", name: "Other" }]),
		});
		await expect(resolvePublication(ctx, "missing")).rejects.toThrow(
			/No publication with slug "missing"/,
		);
	});

	test("throws when resolving a slug with no active account", async () => {
		const { ctx } = readContext({ ownerAddress: undefined });
		await expect(resolvePublication(ctx, "my-blog")).rejects.toThrow(
			/without an active account/,
		);
	});
});

describe("resolveCollection", () => {
	test("returns the override", () => {
		const { ctx } = readContext();
		expect(resolveCollection(ctx, "posts")).toBe("posts");
	});

	test("falls back to the active collection", () => {
		const { ctx } = readContext({ settings: { collection: "active-col" } });
		expect(resolveCollection(ctx, undefined)).toBe("active-col");
	});

	test("throws when no collection is selected", () => {
		const { ctx } = readContext();
		expect(() => resolveCollection(ctx, undefined)).toThrow(
			/No collection selected/,
		);
	});
});
