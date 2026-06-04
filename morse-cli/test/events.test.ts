import { describe, expect, test } from "bun:test";

import {
	type EventQuerier,
	fetchEventStream,
	fetchEventStreams,
} from "../src/cli/events.ts";

interface Page {
	data: Array<{
		type: string;
		parsedJson: unknown;
		timestampMs?: string | null;
	}>;
	hasNextPage: boolean;
	nextCursor: unknown;
}

function querier(pages: Page[]): {
	client: EventQuerier;
	cursors: unknown[];
} {
	const cursors: unknown[] = [];
	let i = 0;
	const client: EventQuerier = {
		queryEvents: (params) => {
			cursors.push(params.cursor);
			if (params.signal?.aborted) {
				return Promise.reject(new Error("aborted"));
			}
			const page = pages[i] ?? {
				data: [],
				hasNextPage: false,
				nextCursor: null,
			};
			i += 1;
			return Promise.resolve(page);
		},
	};
	return { client, cursors };
}

function event(n: number) {
	return {
		type: "0xpkg::file::FileCreated",
		parsedJson: { n },
		timestampMs: `${n}`,
	};
}

describe("fetchEventStream", () => {
	test("walks every page and maps to RecipientFileEventInput", async () => {
		const { client } = querier([
			{ data: [event(1), event(2)], hasNextPage: true, nextCursor: "c1" },
			{ data: [event(3)], hasNextPage: false, nextCursor: null },
		]);
		const out = await fetchEventStream(client, "0xpkg::file::FileCreated");
		expect(out.map((e) => (e.json as { n: number }).n)).toEqual([1, 2, 3]);
		expect(out[0]).toMatchObject({ type: "0xpkg::file::FileCreated" });
	});

	test("passes the previous page's cursor to the next query", async () => {
		const { client, cursors } = querier([
			{ data: [event(1)], hasNextPage: true, nextCursor: "c1" },
			{ data: [event(2)], hasNextPage: false, nextCursor: null },
		]);
		await fetchEventStream(client, "T");
		expect(cursors).toEqual([undefined, "c1"]);
	});

	test("returns empty on an empty first page", async () => {
		const { client } = querier([
			{ data: [], hasNextPage: false, nextCursor: null },
		]);
		expect(await fetchEventStream(client, "T")).toEqual([]);
	});

	test("propagates an aborted signal", async () => {
		const { client } = querier([
			{ data: [event(1)], hasNextPage: false, nextCursor: null },
		]);
		const controller = new AbortController();
		controller.abort();
		await expect(
			fetchEventStream(client, "T", controller.signal),
		).rejects.toThrow(/aborted/);
	});
});

describe("fetchEventStreams", () => {
	test("fetches multiple types and flattens", async () => {
		const { client } = querier([
			{ data: [event(1)], hasNextPage: false, nextCursor: null },
			{ data: [event(2)], hasNextPage: false, nextCursor: null },
		]);
		const out = await fetchEventStreams(client, ["A", "B"]);
		expect(out.length).toBe(2);
	});
});
