import { describe, expect, test } from "bun:test";

import { CliError } from "../src/cli/errors.ts";
import { ExitCode } from "../src/cli/exit-codes.ts";
import {
	canonicalGraphqlUrl,
	GraphqlEventQuerier,
} from "../src/cli/graphql-events.ts";

const TYPE = "0xabc::recipient_file::RecipientFileCreated";

function respond(body: unknown, ok = true, status = 200): typeof fetch {
	return (async () =>
		({
			ok,
			status,
			json: async () => body,
		}) as unknown as Response) as unknown as typeof fetch;
}

describe("canonicalGraphqlUrl", () => {
	test("resolves the Mysten endpoint for the public networks", () => {
		expect(canonicalGraphqlUrl("mainnet")).toBe(
			"https://graphql.mainnet.sui.io/graphql",
		);
		expect(canonicalGraphqlUrl("testnet")).toBe(
			"https://graphql.testnet.sui.io/graphql",
		);
	});

	test("has none for localnet", () => {
		expect(canonicalGraphqlUrl("localnet")).toBeUndefined();
	});
});

describe("GraphqlEventQuerier", () => {
	test("maps nodes onto the EventQuerier shape", async () => {
		const q = new GraphqlEventQuerier(
			"https://gql.test",
			respond({
				data: {
					events: {
						pageInfo: { hasNextPage: true, endCursor: "CUR" },
						nodes: [
							{
								timestamp: "2026-09-09T16:12:34.617Z",
								contents: { json: { file: "0x1" }, type: { repr: TYPE } },
							},
						],
					},
				},
			}),
		);
		const page = await q.queryEvents({ query: { MoveEventType: TYPE } });
		expect(page.data).toHaveLength(1);
		expect(page.data[0]?.type).toBe(TYPE);
		expect(page.data[0]?.parsedJson).toEqual({ file: "0x1" });
		// GraphQL returns ISO-8601; the reconcile helpers want epoch millis.
		expect(page.data[0]?.timestampMs).toBe(
			String(Date.parse("2026-09-09T16:12:34.617Z")),
		);
		expect(page.hasNextPage).toBe(true);
		expect(page.nextCursor).toBe("CUR");
	});

	test("sends the cursor back as `after` only when it is a string", async () => {
		const seen: string[] = [];
		const capture = (async (_url: string, init?: { body?: string }) => {
			seen.push(init?.body ?? "");
			return {
				ok: true,
				status: 200,
				json: async () => ({
					data: { events: { pageInfo: {}, nodes: [] } },
				}),
			} as unknown as Response;
		}) as unknown as typeof fetch;
		const q = new GraphqlEventQuerier("https://gql.test", capture);
		await q.queryEvents({ query: { MoveEventType: TYPE } });
		await q.queryEvents({ query: { MoveEventType: TYPE }, cursor: "CUR" });
		expect(JSON.parse(seen[0] as string).variables.after).toBeNull();
		expect(JSON.parse(seen[1] as string).variables.after).toBe("CUR");
	});

	test("an empty result terminates rather than looping", async () => {
		const q = new GraphqlEventQuerier(
			"https://gql.test",
			respond({ data: { events: { pageInfo: {}, nodes: [] } } }),
		);
		const page = await q.queryEvents({ query: { MoveEventType: TYPE } });
		expect(page.data).toEqual([]);
		expect(page.hasNextPage).toBe(false);
		expect(page.nextCursor).toBeNull();
	});

	test("GraphQL errors surface as a network CliError, not a silent empty page", async () => {
		// Returning [] here would make `file list` report "No files" for a broken
		// endpoint, which is the worst possible answer.
		const q = new GraphqlEventQuerier(
			"https://gql.test",
			respond({ errors: [{ message: "unknown field" }] }),
		);
		const err = await q
			.queryEvents({ query: { MoveEventType: TYPE } })
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(CliError);
		expect((err as CliError).exitCode).toBe(ExitCode.Network);
		expect((err as Error).message).toContain("unknown field");
	});

	test("a non-2xx response is a network error", async () => {
		const q = new GraphqlEventQuerier(
			"https://gql.test",
			respond({}, false, 502),
		);
		const err = await q
			.queryEvents({ query: { MoveEventType: TYPE } })
			.catch((e: unknown) => e);
		expect((err as CliError).exitCode).toBe(ExitCode.Network);
		expect((err as Error).message).toContain("502");
	});

	test("an unreachable endpoint is a network error carrying the cause", async () => {
		const boom = (async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;
		const q = new GraphqlEventQuerier("https://gql.test", boom);
		const err = await q
			.queryEvents({ query: { MoveEventType: TYPE } })
			.catch((e: unknown) => e);
		expect((err as CliError).exitCode).toBe(ExitCode.Network);
		expect((err as Error).cause).toBeInstanceOf(Error);
	});
});
