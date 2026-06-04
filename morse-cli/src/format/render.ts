/** Human-readable renderers for read results. JSON output uses the raw objects. */

import type {
	Collection,
	Entry,
	OwnedPublication,
	OwnerCapId,
	Publication,
	PublicationId,
	PublisherCap,
	RecipientFile,
	RecipientFileSummaryOrFull,
	Revision,
} from "@arcadiasystems/morse-sdk";

import { shortId } from "./ids.ts";

/** An owned publication enriched with its slug and name (one read per row). */
export interface EnrichedPublication {
	readonly slug: string;
	readonly name: string;
	readonly publicationId: PublicationId;
	readonly ownerCapId: OwnerCapId;
}

export function renderEnrichedPublicationList(
	items: readonly EnrichedPublication[],
): string {
	if (items.length === 0) {
		return "No publications owned by this address.";
	}
	return items
		.map((p) => `${p.slug}  ${p.publicationId}  ${p.name}`)
		.join("\n");
}

export function renderPublisherCapList(caps: readonly PublisherCap[]): string {
	if (caps.length === 0) {
		return "No publisher caps held by this address.";
	}
	return caps
		.map(
			(cap) =>
				`${cap.id}  publication ${shortId(cap.publicationId)}  holder ${shortId(cap.holder)}`,
		)
		.join("\n");
}

export function renderCollectionList(
	collections: readonly Collection[],
): string {
	if (collections.length === 0) {
		return "No collections.";
	}
	return collections
		.map((c) => `${c.name}  ${c.storageMode}  (next entry id ${c.nextEntryId})`)
		.join("\n");
}

export function renderPublication(publication: Publication): string {
	const collections =
		publication.collections.length === 0
			? "(none)"
			: publication.collections
					.map((c) => `${c.name} (${c.storageMode})`)
					.join(", ");
	return [
		`${publication.name} (${shortId(publication.id)})`,
		`slug:        ${publication.slug}`,
		`collections: ${collections}`,
	].join("\n");
}

export function renderPublicationList(
	items: readonly OwnedPublication[],
): string {
	if (items.length === 0) {
		return "No publications owned by this address.";
	}
	return items
		.map(
			(item) =>
				`${item.publicationId}  (owner cap ${shortId(item.ownerCapId)})`,
		)
		.join("\n");
}

export function renderEntry(entry: Entry): string {
	const lines = [
		`#${entry.id} ${entry.name}`,
		`publicHead: ${headLabel(entry.publicHead)}  draftHead: ${headLabel(entry.draftHead)}`,
		`revisions:  ${entry.revisions.length}`,
	];
	for (const revision of entry.revisions) {
		lines.push(`  ${renderRevisionLine(revision)}`);
	}
	return lines.join("\n");
}

export function renderEntryList(entries: readonly Entry[]): string {
	if (entries.length === 0) {
		return "No entries in this collection.";
	}
	return entries
		.map(
			(entry) =>
				`#${entry.id} ${entry.name} (${entry.revisions.length} revisions)`,
		)
		.join("\n");
}

export function renderFileList(
	items: readonly RecipientFileSummaryOrFull[],
): string {
	if (items.length === 0) {
		return "No files.";
	}
	const header = "id  name  size  recipients  created";
	const rows = items.map((file) => {
		const created = new Date(file.createdAtMs).toISOString().slice(0, 10);
		return `${shortId(file.id)}  ${file.name}  ${file.size}  ${file.members.length}  ${created}`;
	});
	return [header, ...rows].join("\n");
}

export function renderRecipientFile(file: RecipientFile): string {
	const recipients =
		file.members.length === 0
			? "(none)"
			: file.members.map((m) => `  ${m}`).join("\n");
	return [
		`${file.name} (${shortId(file.id)})`,
		`contentType: ${file.contentType}`,
		`size:        ${file.size}`,
		`blobId:      ${file.blobId}`,
		`owner:       ${file.owner}`,
		`recipients (${file.members.length}):`,
		recipients,
	].join("\n");
}

function headLabel(value: number | null): string {
	return value === null ? "none" : String(value);
}

function renderRevisionLine(revision: Revision): string {
	const ref =
		revision.blobRef.kind === "blob"
			? `blob ${shortId(revision.blobRef.blobObjectId)}`
			: "quilt patch";
	const encrypted = revision.encrypted ? " encrypted" : "";
	return `[${revision.id}] ${revision.contentType} (${ref}) by ${shortId(revision.author)}${encrypted}`;
}
