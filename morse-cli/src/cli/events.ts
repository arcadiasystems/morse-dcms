/**
 * Event fetching for file listing. The SDK ships pure reconcile helpers but no
 * event source; this is the consumer side. It walks one Move event type until
 * the pages run out, mapping each event to the `RecipientFileEventInput` shape
 * the reconcile helpers consume.
 *
 * The interface is still shaped like `suix_queryEvents` because that is what it
 * originally wrapped. Public Sui fullnodes have since retired JSON-RPC, so the
 * shipped implementation is `GraphqlEventQuerier`; the shape is kept because it
 * is a reasonable narrow contract and lets `--indexer-url` point at anything
 * that can answer the same question. Kept behind this interface so the heavy
 * client stays in `cli/context.ts` and the paginator is unit-testable.
 */

import type { RecipientFileEventInput } from "@arcadiasystems/morse-sdk";

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

/** Narrow event-query surface; implemented by `GraphqlEventQuerier`. */
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
): Promise<RecipientFileEventInput[]> {
	const out: RecipientFileEventInput[] = [];
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
				json: (event.parsedJson ?? {}) as Record<string, unknown>,
				timestampMs: event.timestampMs == null ? 0 : Number(event.timestampMs),
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
): Promise<RecipientFileEventInput[]> {
	const streams = await Promise.all(
		eventTypes.map((type) => fetchEventStream(client, type, signal)),
	);
	return streams.flat();
}
