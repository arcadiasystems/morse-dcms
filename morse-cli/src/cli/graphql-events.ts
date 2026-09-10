/**
 * Sui GraphQL implementation of `EventQuerier`.
 *
 * The original source was `suix_queryEvents` over JSON-RPC, which public Sui
 * fullnodes have retired: they answer every JSON-RPC method with "Method not
 * found". gRPC is the documented replacement for most reads, but @mysten/sui's
 * gRPC client exposes no event API at all, so GraphQL is the only transport
 * left that can answer "give me every event of this Move type".
 *
 * Hand-rolled over `fetch` rather than pulling in a GraphQL client: one query,
 * one cursor, and the CLI keeps its dependency surface minimal.
 */

import { CliError } from "./errors.ts";
import type { EventQuerier } from "./events.ts";
import { ExitCode } from "./exit-codes.ts";

/** Canonical Mysten-run GraphQL endpoint for a network. */
export function canonicalGraphqlUrl(
	network: "mainnet" | "testnet" | "localnet",
): string | undefined {
	if (network === "mainnet" || network === "testnet") {
		return `https://graphql.${network}.sui.io/graphql`;
	}
	return undefined;
}

const QUERY = `query Events($type: String!, $first: Int!, $after: String) {
  events(filter: { type: $type }, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { timestamp contents { json type { repr } } }
  }
}`;

interface GraphqlNode {
	readonly timestamp?: string | null;
	readonly contents?: {
		readonly json?: unknown;
		readonly type?: { readonly repr?: string } | null;
	} | null;
}

/** `EventQuerier` backed by a Sui GraphQL endpoint. */
export class GraphqlEventQuerier implements EventQuerier {
	readonly #url: string;
	readonly #fetch: typeof fetch;

	constructor(url: string, fetchImpl: typeof fetch = fetch) {
		this.#url = url;
		this.#fetch = fetchImpl;
	}

	async queryEvents(params: {
		query: { MoveEventType: string };
		cursor?: unknown;
		limit?: number;
		order?: "ascending" | "descending";
		signal?: AbortSignal;
	}): Promise<{
		data: ReadonlyArray<{
			type: string;
			parsedJson: unknown;
			timestampMs?: string | null;
		}>;
		hasNextPage: boolean;
		nextCursor: unknown;
	}> {
		const body = JSON.stringify({
			query: QUERY,
			variables: {
				type: params.query.MoveEventType,
				first: params.limit ?? 50,
				// The caller round-trips our cursor untouched, so it is always the
				// endCursor string we returned, or undefined on the first page.
				after: typeof params.cursor === "string" ? params.cursor : null,
			},
		});
		let response: Response;
		try {
			response = await this.#fetch(this.#url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body,
				...(params.signal === undefined ? {} : { signal: params.signal }),
			});
		} catch (cause) {
			throw new CliError(
				`Could not reach the event source at ${this.#url}.`,
				ExitCode.Network,
				{ cause },
			);
		}
		if (!response.ok) {
			throw new CliError(
				`Event source at ${this.#url} returned HTTP ${response.status}.`,
				ExitCode.Network,
			);
		}
		const payload = (await response.json()) as {
			data?: {
				events?: {
					pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
					nodes?: GraphqlNode[];
				};
			};
			errors?: Array<{ message?: string }>;
		};
		if (payload.errors && payload.errors.length > 0) {
			throw new CliError(
				`Event source rejected the query: ${payload.errors[0]?.message ?? "unknown error"}`,
				ExitCode.Network,
			);
		}
		const events = payload.data?.events;
		const nodes = events?.nodes ?? [];
		return {
			data: nodes.map((node) => ({
				type: node.contents?.type?.repr ?? "",
				parsedJson: node.contents?.json ?? {},
				// The reconcile helpers want epoch millis; GraphQL returns ISO-8601.
				timestampMs:
					node.timestamp == null
						? null
						: String(Date.parse(node.timestamp) || 0),
			})),
			hasNextPage: Boolean(events?.pageInfo?.hasNextPage),
			nextCursor: events?.pageInfo?.endCursor ?? null,
		};
	}
}
