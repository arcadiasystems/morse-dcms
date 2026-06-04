/**
 * Resolve the OwnerCap / PublisherCap needed for a write, either from an
 * explicit flag or by paging the active account's owned caps. Lets users act on
 * a publication by ID alone without tracking cap IDs by hand.
 */

import {
	type OwnerCapId,
	type PublicationId,
	type PublisherCapId,
	type RpcPublicationReader,
	type SuiAddress,
	toOwnerCapId,
	toPublisherCapId,
} from "@arcadiasystems/morse-sdk";

import { CliError } from "../cli/errors.ts";
import { ExitCode } from "../cli/exit-codes.ts";

const PAGE_LIMIT = 50;

export async function resolveOwnerCap(
	reader: RpcPublicationReader,
	address: SuiAddress,
	publicationId: PublicationId,
	override: string | undefined,
	signal: AbortSignal,
): Promise<OwnerCapId> {
	if (override !== undefined) {
		return toOwnerCapId(override);
	}
	let cursor: string | undefined;
	do {
		const page = await reader.listPublicationsOwnedBy(address, {
			limit: PAGE_LIMIT,
			signal,
			...(cursor === undefined ? {} : { cursor }),
		});
		const match = page.results.find((o) => o.publicationId === publicationId);
		if (match !== undefined) {
			return match.ownerCapId;
		}
		cursor = page.nextCursor ?? undefined;
	} while (cursor !== undefined);
	throw new CliError(
		`No OwnerCap for ${publicationId} held by ${address}. Pass --owner-cap, or check that the active account owns it.`,
		ExitCode.NotFound,
	);
}

export async function resolvePublisherCap(
	reader: RpcPublicationReader,
	address: SuiAddress,
	publicationId: PublicationId,
	override: string | undefined,
	signal: AbortSignal,
): Promise<PublisherCapId> {
	if (override !== undefined) {
		return toPublisherCapId(override);
	}
	let cursor: string | undefined;
	do {
		const page = await reader.listPublisherCapsOwnedBy(address, {
			limit: PAGE_LIMIT,
			signal,
			...(cursor === undefined ? {} : { cursor }),
		});
		const match = page.results.find((c) => c.publicationId === publicationId);
		if (match !== undefined) {
			return match.id;
		}
		cursor = page.nextCursor ?? undefined;
	} while (cursor !== undefined);
	throw new CliError(
		`No PublisherCap for ${publicationId} held by ${address}. Pass --publisher-cap, or check that the active account holds one.`,
		ExitCode.NotFound,
	);
}
