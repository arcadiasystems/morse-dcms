import { describe, expect, test } from "bun:test";
import type {
	Collection,
	Entry,
	OwnedPublication,
	Publication,
	PublisherCap,
} from "@arcadiasystems/morse-sdk";

import { shortId } from "../src/format/ids.ts";
import {
	renderCollectionList,
	renderEntry,
	renderEntryList,
	renderPublication,
	renderPublicationList,
	renderPublisherCapList,
} from "../src/format/render.ts";

const ADDR = `0x${"a".repeat(64)}`;

describe("shortId", () => {
	test("abbreviates long ids and passes short ones through", () => {
		expect(shortId(ADDR)).toBe("0xaaaa...aaaa");
		expect(shortId("0xabc")).toBe("0xabc");
	});
});

describe("renderPublication", () => {
	test("shows name, slug, and collections", () => {
		const publication = {
			id: ADDR,
			name: "My Pub",
			slug: "my-pub",
			collections: [
				{
					name: "blog",
					storageMode: "blob",
					nextEntryId: 0,
					entriesTableId: ADDR,
				},
			],
			revokedPublisherCapsTableId: ADDR,
		} as unknown as Publication;
		const out = renderPublication(publication);
		expect(out).toContain("My Pub");
		expect(out).toContain("my-pub");
		expect(out).toContain("blog (blob)");
	});

	test("marks an empty collection set", () => {
		const publication = {
			id: ADDR,
			name: "Empty",
			slug: "empty",
			collections: [],
			revokedPublisherCapsTableId: ADDR,
		} as unknown as Publication;
		expect(renderPublication(publication)).toContain("(none)");
	});
});

describe("renderPublicationList", () => {
	test("handles empty and populated lists", () => {
		expect(renderPublicationList([])).toContain("No publications");
		const items = [
			{ ownerCapId: ADDR, publicationId: ADDR },
		] as unknown as OwnedPublication[];
		expect(renderPublicationList(items)).toContain(ADDR);
	});
});

describe("renderEntry", () => {
	test("shows the heads and revision lines", () => {
		const entry = {
			id: 3,
			name: "post",
			draftHead: null,
			publicHead: 0,
			revisions: [
				{
					id: 0,
					blobRef: { kind: "blob", blobObjectId: ADDR },
					contentType: "text/plain",
					encrypted: false,
					accessPolicy: "public",
					sealId: null,
					author: ADDR,
				},
			],
		} as unknown as Entry;
		const out = renderEntry(entry);
		expect(out).toContain("#3 post");
		expect(out).toContain("publicHead: 0");
		expect(out).toContain("text/plain");
	});
});

describe("renderCollectionList", () => {
	test("handles empty and populated lists", () => {
		expect(renderCollectionList([])).toContain("No collections");
		const collections = [
			{
				name: "blog",
				storageMode: "blob",
				nextEntryId: 2,
				entriesTableId: ADDR,
			},
		] as unknown as Collection[];
		const out = renderCollectionList(collections);
		expect(out).toContain("blog");
		expect(out).toContain("blob");
		expect(out).toContain("next entry id 2");
	});
});

describe("renderPublisherCapList", () => {
	test("handles empty and populated lists", () => {
		expect(renderPublisherCapList([])).toContain("No publisher caps");
		const caps = [
			{ id: ADDR, publicationId: ADDR, holder: ADDR },
		] as unknown as PublisherCap[];
		const out = renderPublisherCapList(caps);
		expect(out).toContain(ADDR);
		expect(out).toContain("holder");
	});
});

describe("renderEntryList", () => {
	test("handles empty and populated lists", () => {
		expect(renderEntryList([])).toContain("No entries");
		const entries = [
			{ id: 1, name: "a", revisions: [], draftHead: null, publicHead: null },
		] as unknown as Entry[];
		expect(renderEntryList(entries)).toContain("#1 a");
	});
});
