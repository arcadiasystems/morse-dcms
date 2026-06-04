/**
 * Event-driven reads for the `recipient_file` module. Pure reconciliation
 * helpers that replay a stream of event payloads into a current-state
 * snapshot, plus a string builder for the fully-qualified Sui event types
 * indexers subscribe to.
 *
 * Event identity is rooted at `recipientFileEventOriginPackageId` (the
 * package address where the `recipient_file` module was FIRST defined).
 * Distinct from `packageId` (current published-at; moves on every upgrade)
 * and `originalPackageId` (publication-modules v1 genesis).
 */

import { toRecipientFileId, toSuiAddress } from "../codecs.js";
import { ValidationError } from "../errors.js";
import type {
	PackageId,
	RecipientFileId,
	RecipientFileSummary,
	SuiAddress,
} from "../types.js";

/** Fully-qualified Move event types for the recipient-file module. */
export interface RecipientFileEventTypes {
	readonly RecipientFileCreated: string;
	readonly RecipientFileDeleted: string;
	readonly RecipientFileMetadataUpdated: string;
	readonly RecipientFileOwnershipTransferred: string;
	readonly RecipientFileSealPrefixAttached: string;
	readonly RecipientAdded: string;
	readonly RecipientRemoved: string;
}

/**
 * Build the fully-qualified event-type strings used by indexers to filter
 * Sui event streams. Pass `config.recipientFileEventOriginPackageId` (NOT
 * `config.packageId`, which moves on upgrades) as `originPackageId`.
 */
export function buildRecipientFileEventTypes(
	originPackageId: PackageId,
): RecipientFileEventTypes {
	const base = `${originPackageId}::recipient_file`;
	return {
		RecipientFileCreated: `${base}::RecipientFileCreated`,
		RecipientFileDeleted: `${base}::RecipientFileDeleted`,
		RecipientFileMetadataUpdated: `${base}::RecipientFileMetadataUpdated`,
		RecipientFileOwnershipTransferred: `${base}::RecipientFileOwnershipTransferred`,
		RecipientFileSealPrefixAttached: `${base}::RecipientFileSealPrefixAttached`,
		RecipientAdded: `${base}::RecipientAdded`,
		RecipientRemoved: `${base}::RecipientRemoved`,
	};
}

/**
 * Input shape for reconciliation. Indexers normalize Sui event envelopes
 * into `{ type, json, timestampMs }`; the helpers below switch on `type`.
 */
export interface RecipientFileEventInput {
	/** Fully-qualified Sui event type. */
	readonly type: string;
	/** Move event payload, decoded as JSON. */
	readonly json: Record<string, unknown>;
	/**
	 * Transaction timestamp in milliseconds. Sourced from the Sui event
	 * envelope; used only for `createdAtMs` on summaries.
	 */
	readonly timestampMs: number;
}

interface MutableSummary {
	id: RecipientFileId;
	owner: SuiAddress;
	name: string;
	contentType: string;
	size: number;
	members: SuiAddress[];
	createdAtMs: number;
}

/**
 * Replay `events` in order to derive every RecipientFile currently owned by
 * `owner`. Pure: same inputs always produce the same output.
 *
 * Files are dropped from the result on `RecipientFileDeleted` and when
 * `RecipientFileOwnershipTransferred` moves them off `owner`. Files
 * transferred TO `owner` are NOT added because the event payload does not
 * carry the file metadata; consumers needing those should re-fetch via
 * `getRecipientFile` or filter `RecipientFileCreated` upstream.
 */
export function reconcileRecipientFilesOwnedBy(
	events: readonly RecipientFileEventInput[],
	owner: SuiAddress,
	types: RecipientFileEventTypes,
): RecipientFileSummary[] {
	const validatedOwner = toSuiAddress(owner);
	const byId = new Map<string, MutableSummary>();

	for (const event of events) {
		applyEvent(event, types, byId);
	}

	return [...byId.values()]
		.filter((s) => s.owner === validatedOwner)
		.map(toSummary);
}

/**
 * Replay `events` in order to derive every RecipientFile where `address` is
 * currently a recipient (owner or member). Pure.
 *
 * Files are added on `RecipientFileCreated` where `address` appears in
 * `members`, and on `RecipientAdded` where `recipient == address`. Files
 * are dropped on `RecipientFileDeleted` and on `RecipientRemoved` where
 * `recipient == address`.
 */
export function reconcileRecipientFilesAccessibleBy(
	events: readonly RecipientFileEventInput[],
	address: SuiAddress,
	types: RecipientFileEventTypes,
): RecipientFileSummary[] {
	const validated = toSuiAddress(address);
	const byId = new Map<string, MutableSummary>();

	for (const event of events) {
		applyEvent(event, types, byId);
	}

	return [...byId.values()]
		.filter((s) => s.members.includes(validated))
		.map(toSummary);
}

function applyEvent(
	event: RecipientFileEventInput,
	types: RecipientFileEventTypes,
	byId: Map<string, MutableSummary>,
): void {
	const j = event.json;
	switch (event.type) {
		case types.RecipientFileCreated: {
			const id = readFileId(j);
			const owner = toSuiAddress(readString(j, "owner"));
			const members = readAddressArray(j, "members");
			byId.set(id, {
				id: id as RecipientFileId,
				owner,
				name: readString(j, "name"),
				contentType: readString(j, "content_type"),
				size: readSafeInteger(j, "size"),
				members,
				createdAtMs: event.timestampMs,
			});
			return;
		}
		case types.RecipientFileDeleted: {
			byId.delete(readFileId(j));
			return;
		}
		case types.RecipientFileMetadataUpdated: {
			const summary = byId.get(readFileId(j));
			if (!summary) return;
			summary.name = readString(j, "name");
			summary.contentType = readString(j, "content_type");
			return;
		}
		case types.RecipientFileOwnershipTransferred: {
			const summary = byId.get(readFileId(j));
			if (!summary) return;
			summary.owner = toSuiAddress(readString(j, "new_owner"));
			return;
		}
		case types.RecipientAdded: {
			const summary = byId.get(readFileId(j));
			if (!summary) return;
			const recipient = toSuiAddress(readString(j, "recipient"));
			if (!summary.members.includes(recipient)) summary.members.push(recipient);
			return;
		}
		case types.RecipientRemoved: {
			const summary = byId.get(readFileId(j));
			if (!summary) return;
			const recipient = toSuiAddress(readString(j, "recipient"));
			summary.members = summary.members.filter((m) => m !== recipient);
			return;
		}
		default:
			return;
	}
}

// Normalize via `toRecipientFileId` so Map keys are canonical 64-char form
// regardless of whether the indexer surfaces short-form or padded ids.
function readFileId(json: Record<string, unknown>): string {
	return toRecipientFileId(readString(json, "file")) as string;
}

function toSummary(s: MutableSummary): RecipientFileSummary {
	return {
		kind: "summary",
		id: s.id,
		owner: s.owner,
		name: s.name,
		contentType: s.contentType,
		size: s.size,
		members: [...s.members],
		createdAtMs: s.createdAtMs,
	};
}

function readString(json: Record<string, unknown>, key: string): string {
	const value = json[key];
	if (typeof value !== "string") {
		throw new ValidationError(
			`Event field ${key} is missing or not a string`,
			key,
		);
	}
	return value;
}

function readSafeInteger(json: Record<string, unknown>, key: string): number {
	const raw = json[key];
	const value = typeof raw === "string" ? Number(raw) : raw;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new ValidationError(
			`Event field ${key} is not a non-negative safe integer: ${JSON.stringify(raw)}`,
			key,
		);
	}
	return value;
}

function readAddressArray(
	json: Record<string, unknown>,
	key: string,
): SuiAddress[] {
	const value = json[key];
	if (!Array.isArray(value)) {
		throw new ValidationError(`Event field ${key} is not an array`, key);
	}
	return value.map((entry, idx) => {
		if (typeof entry !== "string") {
			throw new ValidationError(
				`Event field ${key}[${idx}] is not a string`,
				key,
			);
		}
		return toSuiAddress(entry);
	});
}
