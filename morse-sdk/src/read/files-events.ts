/**
 * Event type constants and pure reconciliation helpers for the file +
 * allowlist modules. Designed for consumers integrating a Sui indexer of
 * their choice: fetch events from your indexer, pass them here, get back a
 * deduplicated `EncryptedFileSummary[]` that reflects the current state.
 *
 * The SDK intentionally does NOT ship an event-fetching client. Sui v2 gRPC
 * has no historical event query method, and the legacy `suix_queryEvents`
 * JSON-RPC endpoint is on Mysten's deprecation track. Picking an indexer
 * (Mysten public, self-hosted, third-party) is a consumer concern; the SDK
 * owns the parsing + reconciliation logic which is the morse-contract-
 * specific part.
 *
 * Pagination, retention, auth, and CORS are entirely the consumer's
 * responsibility; they live with the indexer client, not here.
 */

import { ValidationError } from "../errors.js";
import type {
	AllowlistId,
	EncryptedFileId,
	EncryptedFileSummary,
	PackageId,
	SuiAddress,
} from "../types.js";

/** Fully-qualified event type strings emitted by the `file` and `allowlist` modules. */
export interface FilesEventTypes {
	readonly FileCreated: string;
	readonly FileDeleted: string;
	readonly FileMetadataUpdated: string;
	readonly FileOwnershipTransferred: string;
	readonly AllowlistCreated: string;
	readonly AllowlistDeleted: string;
	readonly MemberAdded: string;
	readonly MemberRemoved: string;
	readonly CapTransferred: string;
}

/**
 * Build the fully-qualified event type strings for a given file-events
 * origin package id. The origin id is the package where the event structs
 * were FIRST defined, which is independent of `config.packageId` (the
 * current published-at, which moves on every upgrade).
 *
 * Pass `config.filesEventOriginPackageId` here. The SDK ships the testnet
 * default in `morseConfig`; custom deployments supply their own.
 *
 * @throws {ValidationError} If `packageId` is missing.
 */
export function buildFilesEventTypes(packageId: PackageId): FilesEventTypes {
	if (!packageId) {
		throw new ValidationError(
			"buildFilesEventTypes: packageId is required (pass config.filesEventOriginPackageId)",
			"packageId",
		);
	}
	return {
		FileCreated: `${packageId}::file::FileCreated`,
		FileDeleted: `${packageId}::file::FileDeleted`,
		FileMetadataUpdated: `${packageId}::file::FileMetadataUpdated`,
		FileOwnershipTransferred: `${packageId}::file::FileOwnershipTransferred`,
		AllowlistCreated: `${packageId}::allowlist::AllowlistCreated`,
		AllowlistDeleted: `${packageId}::allowlist::AllowlistDeleted`,
		MemberAdded: `${packageId}::allowlist::MemberAdded`,
		MemberRemoved: `${packageId}::allowlist::MemberRemoved`,
		CapTransferred: `${packageId}::allowlist::CapTransferred`,
	};
}

/**
 * Minimal event shape consumed by the reconcile helpers. Compatible with
 * Sui RPC `SuiEvent` and most indexer event payloads. Map your indexer's
 * output to this shape before calling.
 */
export interface FilesEventInput {
	/** Fully-qualified event type, e.g. `${pkg}::file::FileCreated`. */
	readonly type: string;
	/** Decoded event payload (the Move struct's fields, snake_case). */
	readonly parsedJson: unknown;
	/**
	 * Transaction timestamp in milliseconds, sourced from the event
	 * envelope. May be null on pending events (skip those; they do not
	 * count as confirmed history).
	 */
	readonly timestampMs?: string | number | null;
}

// FileCreated payload shape (from morse-contracts/sources/file.move)

interface FileCreatedPayload {
	readonly file: string;
	readonly owner: string;
	readonly allowlist_id: string | { vec: readonly string[] } | null;
	readonly encrypted: boolean;
	readonly name: string;
	readonly content_type: string;
	readonly size: string | number;
}

interface FileDeletedPayload {
	readonly file: string;
	readonly name: string;
}

interface FileOwnershipTransferredPayload {
	readonly file: string;
	readonly previous_owner: string;
	readonly new_owner: string;
}

interface MemberChangePayload {
	readonly allowlist: string;
	readonly member: string;
}

interface AllowlistDeletedPayload {
	readonly allowlist: string;
	readonly name: string;
}

/**
 * Reconcile a stream of Sui events into the current set of files owned by
 * `address`. Caller is responsible for fetching events (typically via an
 * indexer); pass all `FileCreated`, `FileOwnershipTransferred`, and
 * `FileDeleted` events from the event types built via `buildFilesEventTypes`.
 *
 * Order-independence: events are sorted internally by `timestampMs` before
 * reconciliation, so passing them in arbitrary order produces the same
 * result. Events with `timestampMs === null` are skipped (unconfirmed).
 *
 * Best-effort: if `FileOwnershipTransferred` references a `file` whose
 * `FileCreated` is missing from the input (e.g. retention pruning), the
 * incoming transfer is dropped silently; there is no way to recover the
 * metadata without the original event. Increase the indexer's event
 * window if completeness is critical.
 */
export function reconcileFilesOwnedBy(
	events: readonly FilesEventInput[],
	address: SuiAddress,
	eventTypes: FilesEventTypes,
): EncryptedFileSummary[] {
	const known: Map<string, EncryptedFileSummary> = new Map();
	const owners: Map<string, string> = new Map();

	const sorted = sortByTimestamp(events);
	for (const event of sorted) {
		const ts = parseTimestampMs(event.timestampMs);
		if (ts === null) continue;

		if (event.type === eventTypes.FileCreated) {
			const payload = event.parsedJson as FileCreatedPayload;
			const summary = payloadToSummary(payload, ts);
			known.set(summary.id as unknown as string, summary);
			owners.set(summary.id as unknown as string, summary.owner as string);
		} else if (event.type === eventTypes.FileOwnershipTransferred) {
			const payload = event.parsedJson as FileOwnershipTransferredPayload;
			owners.set(payload.file, payload.new_owner);
		} else if (event.type === eventTypes.FileDeleted) {
			const payload = event.parsedJson as FileDeletedPayload;
			known.delete(payload.file);
			owners.delete(payload.file);
		}
	}

	const out: EncryptedFileSummary[] = [];
	for (const [fileId, summary] of known) {
		if (owners.get(fileId) === (address as unknown as string)) {
			out.push(summary);
		}
	}
	return out.sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/**
 * Reconcile a stream of events into the current set of files where
 * `address` has decrypt access via allowlist membership. Caller passes
 * `MemberAdded`, `MemberRemoved`, `AllowlistDeleted`, `FileCreated`, and
 * `FileDeleted` events.
 *
 * Same best-effort guarantees as `reconcileFilesOwnedBy`. Files referencing
 * an `AllowlistDeleted` allowlist are dropped (the on-chain `seal_approve`
 * dry-run would fail for them anyway).
 */
export function reconcileFilesAccessibleBy(
	events: readonly FilesEventInput[],
	address: SuiAddress,
	eventTypes: FilesEventTypes,
): EncryptedFileSummary[] {
	const memberAllowlists: Set<string> = new Set();
	const deletedAllowlists: Set<string> = new Set();
	const knownFiles: Map<string, EncryptedFileSummary> = new Map();

	const sorted = sortByTimestamp(events);
	for (const event of sorted) {
		const ts = parseTimestampMs(event.timestampMs);
		if (ts === null) continue;

		if (event.type === eventTypes.MemberAdded) {
			const payload = event.parsedJson as MemberChangePayload;
			if (payload.member === (address as unknown as string)) {
				memberAllowlists.add(payload.allowlist);
			}
		} else if (event.type === eventTypes.MemberRemoved) {
			const payload = event.parsedJson as MemberChangePayload;
			if (payload.member === (address as unknown as string)) {
				memberAllowlists.delete(payload.allowlist);
			}
		} else if (event.type === eventTypes.AllowlistDeleted) {
			const payload = event.parsedJson as AllowlistDeletedPayload;
			deletedAllowlists.add(payload.allowlist);
			memberAllowlists.delete(payload.allowlist);
		} else if (event.type === eventTypes.FileCreated) {
			const payload = event.parsedJson as FileCreatedPayload;
			const summary = payloadToSummary(payload, ts);
			knownFiles.set(summary.id as unknown as string, summary);
		} else if (event.type === eventTypes.FileDeleted) {
			const payload = event.parsedJson as FileDeletedPayload;
			knownFiles.delete(payload.file);
		}
	}

	const out: EncryptedFileSummary[] = [];
	for (const summary of knownFiles.values()) {
		if (summary.allowlistId === null) continue;
		const allowlistKey = summary.allowlistId as unknown as string;
		if (deletedAllowlists.has(allowlistKey)) continue;
		if (!memberAllowlists.has(allowlistKey)) continue;
		out.push(summary);
	}
	return out.sort((a, b) => b.createdAtMs - a.createdAtMs);
}

// internal

function sortByTimestamp(
	events: readonly FilesEventInput[],
): readonly FilesEventInput[] {
	return [...events].sort((a, b) => {
		const ta = parseTimestampMs(a.timestampMs) ?? Number.POSITIVE_INFINITY;
		const tb = parseTimestampMs(b.timestampMs) ?? Number.POSITIVE_INFINITY;
		return ta - tb;
	});
}

function parseTimestampMs(
	value: string | number | null | undefined,
): number | null {
	if (value === null || value === undefined) return null;
	const num = typeof value === "string" ? Number(value) : value;
	return Number.isFinite(num) ? num : null;
}

function payloadToSummary(
	payload: FileCreatedPayload,
	createdAtMs: number,
): EncryptedFileSummary {
	return {
		kind: "summary",
		id: payload.file as unknown as EncryptedFileId,
		owner: payload.owner as unknown as SuiAddress,
		name: payload.name,
		contentType: payload.content_type,
		size:
			typeof payload.size === "string" ? Number(payload.size) : payload.size,
		encrypted: payload.encrypted,
		allowlistId: extractAllowlistId(payload.allowlist_id),
		createdAtMs,
	};
}

/**
 * `Option<ID>` in Move serializes as either a plain string (the address),
 * `null`, or `{ vec: [address] | [] }` depending on the indexer's decoder.
 * Normalize all three to `AllowlistId | null`.
 */
function extractAllowlistId(
	raw: string | { vec: readonly string[] } | null,
): AllowlistId | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "string") return raw as unknown as AllowlistId;
	if (Array.isArray(raw.vec) && raw.vec.length > 0 && raw.vec[0]) {
		return raw.vec[0] as unknown as AllowlistId;
	}
	return null;
}
