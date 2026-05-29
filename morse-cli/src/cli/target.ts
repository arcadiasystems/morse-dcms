/**
 * Resolve the target publication and collection from a `-P`/`-C` flag or the
 * active context. A publication may be given as an object id or as a slug; slugs
 * are matched against the active account's owned publications (the registry has
 * no slug index, so resolution is scoped to publications you own).
 */

import { type PublicationId, toPublicationId } from "@arcadiasystems/morse-sdk";

import type { ReadContext } from "./context.ts";
import { UsageError } from "./errors.ts";

const OBJECT_ID = /^0x[0-9a-f]{1,64}$/i;
const SLUG_PAGE_LIMIT = 50;

/** Resolve a publication from `--publication <slug|id>` or the active context. */
export async function resolvePublication(
	ctx: ReadContext,
	override: string | undefined,
): Promise<PublicationId> {
	const value = override ?? ctx.settings.publication;
	if (value === undefined) {
		throw new UsageError(
			"No publication selected. Pass --publication <slug|id> or run `morse use <slug|id>`.",
		);
	}
	if (OBJECT_ID.test(value)) {
		// The SDK codec accepts lowercase hex only; normalize so a mixed-case id
		// is treated as an id rather than misrouted to slug resolution.
		return toPublicationId(value.toLowerCase());
	}
	return resolveSlug(ctx, value);
}

/** Resolve a collection from `--collection <name>` or the active context. */
export function resolveCollection(
	ctx: ReadContext,
	override: string | undefined,
): string {
	const value = override ?? ctx.settings.collection;
	if (value === undefined) {
		throw new UsageError(
			"No collection selected. Pass --collection <name> or run `morse use <slug|id> <collection>`.",
		);
	}
	return value;
}

async function resolveSlug(
	ctx: ReadContext,
	slug: string,
): Promise<PublicationId> {
	if (ctx.ownerAddress === undefined) {
		throw new UsageError(
			`Cannot resolve the slug "${slug}" without an active account. Pass the publication id, or select an account.`,
		);
	}
	ctx.output.info(`Resolving slug "${slug}" among owned publications...`);
	// One getPublication per owned publication (the list RPC omits the slug).
	// Acceptable since this only runs for the explicit slug case and is scoped
	// to publications the active account owns.
	let cursor: string | undefined;
	do {
		const page = await ctx.reader.listPublicationsOwnedBy(ctx.ownerAddress, {
			limit: SLUG_PAGE_LIMIT,
			signal: ctx.signal,
			...(cursor === undefined ? {} : { cursor }),
		});
		for (const owned of page.results) {
			const publication = await ctx.reader.getPublication(
				owned.publicationId,
				ctx.signal,
			);
			if (publication.slug === slug) {
				return publication.id;
			}
		}
		cursor = page.nextCursor ?? undefined;
	} while (cursor !== undefined);
	throw new UsageError(
		`No publication with slug "${slug}" owned by the active account. Pass the publication id instead.`,
	);
}
