/**
 * Event fetching for file listing. The SDK ships pure reconcile helpers but no
 * event source; this is the consumer side. It walks `suix_queryEvents` (via the
 * JSON-RPC client) for a Move event type until the pages run out, mapping each
 * event to the `FilesEventInput` shape the reconcile helpers consume.
 *
 * This is a deprecated Sui endpoint (Mysten is sunsetting `suix_queryEvents`);
 * the listing commands accept `--indexer-url` so users can point at any source
 * that speaks the same query. Kept behind a narrow interface so the heavy
 * client stays in `cli/context.ts` and the paginator is unit-testable.
 */

import type { FilesEventInput } from "@arcadiasystems/morse-sdk";

const PAGE_LIMIT = 50;

interface EventPage {
	readonly data: ReadonlyArray<{
		readonly type: string;
		readonly parsedJson: unknown;
		readonly timestampMs?: string | null;
	}>;
	readonly hasNextPage: boolean;
	readonly nextCursor: unknown;
}

/** Minimal `suix_queryEvents` surface; satisfied by `@mysten/sui` SuiJsonRpcClient. */
export interface EventQuerier {
	queryEvents(params: {
		query: { MoveEventType: string };
		cursor?: unknown;
		limit?: number;
		order?: "ascending" | "descending";
		signal?: AbortSignal;
	}): Promise<EventPage>;
}

/** Walk every page of one Move event type, newest-first. */
export async function fetchEventStream(
	client: EventQuerier,
	eventType: string,
	signal?: AbortSignal,
): Promise<FilesEventInput[]> {
	const out: FilesEventInput[] = [];
	let cursor: unknown;
	for (;;) {
		const page = await client.queryEvents({
			query: { MoveEventType: eventType },
			limit: PAGE_LIMIT,
			order: "descending",
			...(cursor === undefined ? {} : { cursor }),
			...(signal === undefined ? {} : { signal }),
		});
		for (const event of page.data) {
			out.push({
				type: event.type,
				parsedJson: event.parsedJson,
				timestampMs: event.timestampMs,
			});
		}
		if (
			!page.hasNextPage ||
			page.nextCursor === null ||
			page.nextCursor === undefined
		) {
			break;
		}
		cursor = page.nextCursor;
	}
	return out;
}

/** Fetch several event-type streams concurrently and flatten them. */
export async function fetchEventStreams(
	client: EventQuerier,
	eventTypes: readonly string[],
	signal?: AbortSignal,
): Promise<FilesEventInput[]> {
	const streams = await Promise.all(
		eventTypes.map((type) => fetchEventStream(client, type, signal)),
	);
	return streams.flat();
}
