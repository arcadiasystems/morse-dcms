/**
 * Checks shared by the commands that upload content and then attach it on
 * chain. Each failure here is knowable from reads, so it is raised before
 * anything is encrypted or uploaded: Walrus storage is paid for at upload, and
 * a transaction that then aborts leaves that blob stranded.
 */

import {
	type PublicationId,
	type PublisherCapId,
	StorageMode,
} from "@arcadiasystems/morse-sdk";

import type { WriteContext } from "../cli/context.ts";
import { CliError, UsageError } from "../cli/errors.ts";
import { ExitCode } from "../cli/exit-codes.ts";
import { shortId } from "../format/ids.ts";
import { resolvePublisherCap } from "./resolve.ts";

export interface ContentWriteTarget {
	readonly publicationId: PublicationId;
	readonly collection: string;
	/** The `--publisher-cap` override, when given. */
	readonly publisherCap: string | undefined;
	/** The command named in the quilt refusal, for example "revision append-draft". */
	readonly command: string;
}

/**
 * Resolve the PublisherCap for a content write, refusing a missing or
 * quilt-mode collection (exit 2) and a revoked cap (exit 4).
 */
export async function authorizeContentWrite(
	ctx: WriteContext,
	target: ContentWriteTarget,
): Promise<PublisherCapId> {
	const { publicationId, collection } = target;
	const publication = await ctx.reader.getPublication(
		publicationId,
		ctx.signal,
	);
	const found = publication.collections.find(
		(item) => item.name === collection,
	);
	if (found === undefined) {
		throw new UsageError(
			`Publication ${shortId(publicationId)} has no collection "${collection}".`,
		);
	}
	if (found.storageMode === StorageMode.Quilt) {
		throw new UsageError(
			`Collection "${collection}" uses quilt storage, which \`${target.command}\` does not support yet. Use a blob-mode collection.`,
		);
	}
	const publisherCapId = await resolvePublisherCap(
		ctx.reader,
		ctx.address,
		publicationId,
		target.publisherCap,
		ctx.signal,
	);
	// An explicit cap id skips the "caps this account holds for this
	// publication" search, so a cap for someone else or another publication
	// would otherwise be encrypted and uploaded, then abort on chain.
	if (target.publisherCap !== undefined) {
		const cap = await ctx.reader.getPublisherCap(publisherCapId, ctx.signal);
		if (cap.publicationId !== publicationId) {
			throw new CliError(
				`PublisherCap ${shortId(publisherCapId)} belongs to publication ${shortId(cap.publicationId)}, not ${shortId(publicationId)}.`,
				ExitCode.Auth,
			);
		}
		if (cap.holder !== ctx.address) {
			throw new CliError(
				"The sender is not the approved holder for this PublisherCap.",
				ExitCode.Auth,
			);
		}
	}
	const revoked = await ctx.reader.isPublisherCapRevoked(
		publicationId,
		publisherCapId,
		ctx.signal,
	);
	if (revoked) {
		throw new CliError(
			"The PublisherCap has been revoked and can no longer be used.",
			ExitCode.Auth,
		);
	}
	return publisherCapId;
}
