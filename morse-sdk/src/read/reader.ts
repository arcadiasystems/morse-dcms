/**
 * Read layer for publications: a swappable interface plus an RPC-backed
 * implementation. Future indexer implementations satisfy the same interface.
 */

import type { SuiClientTypes } from "@mysten/sui/client";

import type { ObjectReader } from "../clients.js";
import {
	accessPolicyFromU8,
	storageModeFromU8,
	toBlobObjectId,
	toOwnerCapId,
	toPublicationId,
	toPublisherCapId,
	toQuiltPatchId,
	toSuiAddress,
	toSuiObjectId,
} from "../codecs.js";
import { NotFoundError, TransportError, ValidationError } from "../errors.js";
import type {
	BlobRef,
	Collection,
	Entry,
	OwnerCapId,
	PackageId,
	Publication,
	PublicationId,
	PublisherCap,
	PublisherCapId,
	Revision,
	SealId,
	SuiAddress,
	SuiObjectId,
} from "../types.js";
import { EntryBcs, EntryIdBcs } from "./entry-bcs.js";

const DEFAULT_PAGE_LIMIT = 50;

/** Lightweight handle returned by `listPublicationsOwnedBy`. */
export interface OwnedPublication {
	readonly ownerCapId: OwnerCapId;
	readonly publicationId: PublicationId;
}

/** Result of a single page of `listPublicationsOwnedBy`. */
export interface PublicationListPage {
	readonly results: readonly OwnedPublication[];
	readonly nextCursor: string | null;
}

/** Options for `listPublicationsOwnedBy`. */
export interface ListPublicationsOptions {
	readonly limit?: number;
	readonly cursor?: string;
	readonly signal?: AbortSignal;
}

/** Result of a single page of `listPublisherCapsOwnedBy`. */
export interface PublisherCapListPage {
	readonly results: readonly PublisherCap[];
	readonly nextCursor: string | null;
}

/** Options for `listPublisherCapsOwnedBy`. */
export interface ListPublisherCapsOptions {
	readonly limit?: number;
	readonly cursor?: string;
	readonly signal?: AbortSignal;
}

/** Result of a single page of `listEntries`. */
export interface EntryListPage {
	readonly results: readonly Entry[];
	readonly nextCursor: string | null;
}

/**
 * Options for `listEntries`. Order is the dynamic-field object-store order, not
 * insertion order; sort by `entry.id` for chronological order. By default
 * `limit` is `DEFAULT_PAGE_LIMIT` and the cursor is opaque to consumers.
 */
export interface ListEntriesOptions {
	readonly limit?: number;
	readonly cursor?: string;
	readonly signal?: AbortSignal;
}

/** Options for `scanEntries`. `pageSize` controls the per-RPC page size. */
export interface ScanEntriesOptions {
	readonly pageSize?: number;
	readonly signal?: AbortSignal;
}

/**
 * Read-only access to the publication domain: publications and the
 * PublisherCaps that grant write access to them.
 */
export interface PublicationReader {
	/**
	 * Fetch a publication by ID.
	 * @throws {NotFoundError} If no object exists at the given ID.
	 * @throws {ValidationError} If the on-chain JSON does not match the expected shape.
	 * @throws {TransportError} On RPC failure.
	 */
	getPublication(id: PublicationId, signal?: AbortSignal): Promise<Publication>;

	/**
	 * Page through publications owned (via OwnerCap) by an address.
	 * @throws {TransportError} On RPC failure.
	 */
	listPublicationsOwnedBy(
		address: SuiAddress,
		options?: ListPublicationsOptions,
	): Promise<PublicationListPage>;

	/**
	 * Fetch a PublisherCap by ID.
	 * @throws {NotFoundError} If no object exists at the given ID.
	 * @throws {ValidationError} If the on-chain JSON does not match the expected shape.
	 * @throws {TransportError} On RPC failure.
	 */
	getPublisherCap(
		id: PublisherCapId,
		signal?: AbortSignal,
	): Promise<PublisherCap>;

	/**
	 * Page through PublisherCaps owned by an address.
	 * @throws {TransportError} On RPC failure.
	 */
	listPublisherCapsOwnedBy(
		address: SuiAddress,
		options?: ListPublisherCapsOptions,
	): Promise<PublisherCapListPage>;

	/**
	 * Fetch a single entry by collection name and entry id.
	 * @throws {NotFoundError} If the collection or entry does not exist.
	 * @throws {ValidationError} If the on-chain bytes do not match the BCS schema.
	 * @throws {TransportError} On RPC failure.
	 */
	getEntry(
		publicationId: PublicationId,
		collectionName: string,
		entryId: number,
		signal?: AbortSignal,
	): Promise<Entry>;

	/**
	 * Fetch a single revision by collection name, entry id, and revision id.
	 * @throws {NotFoundError} If the collection, entry, or revision does not exist.
	 * @throws {ValidationError} If the on-chain bytes do not match the BCS schema.
	 * @throws {TransportError} On RPC failure.
	 */
	getRevision(
		publicationId: PublicationId,
		collectionName: string,
		entryId: number,
		revisionId: number,
		signal?: AbortSignal,
	): Promise<Revision>;

	/**
	 * Page through entries in a collection. See `ListEntriesOptions` for
	 * ordering and pagination semantics.
	 *
	 * @throws {NotFoundError} If the collection does not exist.
	 * @throws {ValidationError} If the on-chain bytes do not match the BCS schema.
	 * @throws {TransportError} On RPC failure.
	 */
	listEntries(
		publicationId: PublicationId,
		collectionName: string,
		options?: ListEntriesOptions,
	): Promise<EntryListPage>;

	/**
	 * Iterate every entry in a collection. Auto-paginates `listEntries` until
	 * the cursor is exhausted; consumers can `for await` and break early. Same
	 * ordering caveat as `listEntries` (object-store, not chronological).
	 *
	 * @throws {NotFoundError} If the collection does not exist.
	 * @throws {ValidationError} If the on-chain bytes do not match the BCS schema.
	 * @throws {TransportError} On RPC failure.
	 */
	scanEntries(
		publicationId: PublicationId,
		collectionName: string,
		options?: ScanEntriesOptions,
	): AsyncIterable<Entry>;
}

/** RPC-backed `PublicationReader` using a Sui client. */
export class RpcPublicationReader implements PublicationReader {
	/**
	 * @param originalPackageId The canonical (`original-id`) package address.
	 *   Required by Sui type filters, which always use the original-id form
	 *   regardless of the package's current upgrade version.
	 */
	constructor(
		private readonly client: ObjectReader,
		private readonly originalPackageId: PackageId,
	) {}

	/**
	 * Build a reader from a morse package config (typically the value returned
	 * by `morseConfig({network})`). Picks `originalPackageId ?? packageId`
	 * internally; passing the post-upgrade `packageId` to the constructor
	 * directly would silently empty type-filtered list results.
	 */
	static fromMorseConfig(
		config: { packageId: PackageId; originalPackageId?: PackageId },
		client: ObjectReader,
	): RpcPublicationReader {
		return new RpcPublicationReader(
			client,
			config.originalPackageId ?? config.packageId,
		);
	}

	async getPublication(
		id: PublicationId,
		signal?: AbortSignal,
	): Promise<Publication> {
		let response: Awaited<ReturnType<ObjectReader["getObject"]>>;
		try {
			response = await this.callClient("getObject", () =>
				this.client.getObject({
					objectId: id,
					include: { json: true },
					...(signal === undefined ? {} : { signal }),
				}),
			);
		} catch (error) {
			if (
				error instanceof TransportError &&
				isObjectNotFoundError(error.cause, id)
			) {
				throw new NotFoundError("publication", id, { cause: error.cause });
			}
			throw error;
		}
		const object = response.object;
		if (!object) {
			throw new NotFoundError("publication", id);
		}
		return parsePublication(object);
	}

	async listPublicationsOwnedBy(
		address: SuiAddress,
		options: ListPublicationsOptions = {},
	): Promise<PublicationListPage> {
		const { limit = DEFAULT_PAGE_LIMIT, cursor, signal } = options;
		const ownerCapType = `${this.originalPackageId}::publication::OwnerCap`;
		const response = await this.callClient("listOwnedObjects", () =>
			this.client.listOwnedObjects({
				owner: address,
				type: ownerCapType,
				limit,
				cursor: cursor ?? null,
				include: { json: true },
				...(signal === undefined ? {} : { signal }),
			}),
		);
		const results = response.objects.map((object) =>
			parseOwnedPublication(object),
		);
		return { results, nextCursor: response.cursor };
	}

	async getPublisherCap(
		id: PublisherCapId,
		signal?: AbortSignal,
	): Promise<PublisherCap> {
		let response: Awaited<ReturnType<ObjectReader["getObject"]>>;
		try {
			response = await this.callClient("getObject", () =>
				this.client.getObject({
					objectId: id,
					include: { json: true },
					...(signal === undefined ? {} : { signal }),
				}),
			);
		} catch (error) {
			if (
				error instanceof TransportError &&
				isObjectNotFoundError(error.cause, id)
			) {
				throw new NotFoundError("publisher-cap", id, { cause: error.cause });
			}
			throw error;
		}
		const object = response.object;
		if (!object) {
			throw new NotFoundError("publisher-cap", id);
		}
		return parsePublisherCap(object);
	}

	async listPublisherCapsOwnedBy(
		address: SuiAddress,
		options: ListPublisherCapsOptions = {},
	): Promise<PublisherCapListPage> {
		const { limit = DEFAULT_PAGE_LIMIT, cursor, signal } = options;
		const publisherCapType = `${this.originalPackageId}::publication::PublisherCap`;
		const response = await this.callClient("listOwnedObjects", () =>
			this.client.listOwnedObjects({
				owner: address,
				type: publisherCapType,
				limit,
				cursor: cursor ?? null,
				include: { json: true },
				...(signal === undefined ? {} : { signal }),
			}),
		);
		const results = response.objects.map((object) => parsePublisherCap(object));
		return { results, nextCursor: response.cursor };
	}

	async getEntry(
		publicationId: PublicationId,
		collectionName: string,
		entryId: number,
		signal?: AbortSignal,
	): Promise<Entry> {
		const tableId = await this.entriesTableId(
			publicationId,
			collectionName,
			signal,
		);
		const nameBcs = EntryIdBcs.serialize(entryId).toBytes();
		let response: SuiClientTypes.GetDynamicFieldResponse;
		try {
			response = await this.callClient("getDynamicField", () =>
				this.client.getDynamicField({
					parentId: tableId,
					name: { type: "u64", bcs: nameBcs },
					...(signal === undefined ? {} : { signal }),
				}),
			);
		} catch (error) {
			if (
				error instanceof TransportError &&
				isDynamicFieldNotFoundError(error.cause)
			) {
				throw new NotFoundError("entry", `${collectionName}:${entryId}`, {
					cause: error.cause,
				});
			}
			throw error;
		}
		return parseEntry(response.dynamicField.value.bcs, entryId);
	}

	async getRevision(
		publicationId: PublicationId,
		collectionName: string,
		entryId: number,
		revisionId: number,
		signal?: AbortSignal,
	): Promise<Revision> {
		const entry = await this.getEntry(
			publicationId,
			collectionName,
			entryId,
			signal,
		);
		const revision = entry.revisions[revisionId];
		if (!revision) {
			throw new NotFoundError(
				"revision",
				`${collectionName}:${entryId}:${revisionId}`,
			);
		}
		return revision;
	}

	async listEntries(
		publicationId: PublicationId,
		collectionName: string,
		options: ListEntriesOptions = {},
	): Promise<EntryListPage> {
		const { limit = DEFAULT_PAGE_LIMIT, cursor, signal } = options;
		const tableId = await this.entriesTableId(
			publicationId,
			collectionName,
			signal,
		);
		const response = await this.callClient("listDynamicFields", () =>
			this.client.listDynamicFields({
				parentId: tableId,
				limit,
				cursor: cursor ?? null,
				include: { value: true },
				...(signal === undefined ? {} : { signal }),
			}),
		);
		const results = response.dynamicFields.map((field) =>
			parseDynamicEntry(field),
		);
		return { results, nextCursor: response.cursor };
	}

	async *scanEntries(
		publicationId: PublicationId,
		collectionName: string,
		options: ScanEntriesOptions = {},
	): AsyncIterable<Entry> {
		const { pageSize = DEFAULT_PAGE_LIMIT, signal } = options;
		let cursor: string | undefined;
		while (true) {
			const page = await this.listEntries(publicationId, collectionName, {
				limit: pageSize,
				...(cursor === undefined ? {} : { cursor }),
				...(signal === undefined ? {} : { signal }),
			});
			for (const entry of page.results) {
				yield entry;
			}
			if (page.nextCursor === null) {
				return;
			}
			cursor = page.nextCursor;
		}
	}

	private async entriesTableId(
		publicationId: PublicationId,
		collectionName: string,
		signal?: AbortSignal,
	): Promise<SuiObjectId> {
		const publication = await this.getPublication(publicationId, signal);
		const collection = publication.collections.find(
			(c) => c.name === collectionName,
		);
		if (!collection) {
			throw new NotFoundError(
				"collection",
				`${publicationId}:${collectionName}`,
			);
		}
		return collection.entriesTableId;
	}

	private async callClient<T>(
		operation: string,
		call: () => Promise<T>,
	): Promise<T> {
		try {
			return await call();
		} catch (cause) {
			throw new TransportError(`${operation} failed`, { cause });
		}
	}
}

function parsePublication(
	object: SuiClientTypes.Object<{ json: true }>,
): Publication {
	const json = object.json;
	if (!json) {
		throw new ValidationError(
			`Publication ${object.objectId} has no parsed JSON content`,
			"publication.json",
		);
	}
	const id = toPublicationId(object.objectId);
	const name = readString(json, "name", "publication.name");
	const slug = readString(json, "slug", "publication.slug");
	const collections = parseCollections(json.collections);
	const revokedPublisherCapsTableId = parseTableId(
		json.revoked_publisher_caps,
		"publication.revoked_publisher_caps",
	);
	return {
		id,
		name,
		slug,
		collections,
		revokedPublisherCapsTableId,
	};
}

function parseCollections(value: unknown): readonly Collection[] {
	if (value === null || typeof value !== "object") {
		throw new ValidationError(
			"Publication collections field is missing or not an object",
			"publication.collections",
		);
	}
	const contents = (value as { contents?: unknown }).contents;
	if (!Array.isArray(contents)) {
		throw new ValidationError(
			"Publication collections.contents is not an array",
			"publication.collections.contents",
		);
	}
	return contents.map((entry, index) => parseCollection(entry, index));
}

function parseCollection(value: unknown, index: number): Collection {
	const path = `publication.collections[${index}]`;
	if (value === null || typeof value !== "object") {
		throw new ValidationError(`${path} is not an object`, path);
	}
	const inner = (value as { value?: unknown }).value;
	if (inner === null || typeof inner !== "object") {
		throw new ValidationError(
			`${path}.value is not an object`,
			`${path}.value`,
		);
	}
	const collection = inner as Record<string, unknown>;
	return {
		name: readString(collection, "name", `${path}.name`),
		storageMode: storageModeFromU8(
			readU8(collection, "storage_mode", `${path}.storage_mode`),
		),
		nextEntryId: readSafeInteger(
			collection,
			"next_entry_id",
			`${path}.next_entry_id`,
		),
		entriesTableId: parseTableId(collection.entries, `${path}.entries`),
	};
}

function parsePublisherCap(
	object: SuiClientTypes.Object<{ json: true }>,
): PublisherCap {
	const json = object.json;
	if (!json || typeof json !== "object") {
		throw new ValidationError(
			`PublisherCap ${object.objectId} has no parsed JSON content`,
			"publisherCap.json",
		);
	}
	// Move `ID` and `address` fields serialize as bare hex strings.
	// Move `UID` (e.g. the struct's own `id` field) serializes as `{ id: "0x..." }`;
	// we use `object.objectId` from the SDK metadata wrapper for the cap's ID instead.
	const fields = json as { publication_id?: unknown; holder?: unknown };
	if (typeof fields.publication_id !== "string") {
		throw new ValidationError(
			"PublisherCap.publication_id is missing or not a string",
			"publisherCap.publication_id",
		);
	}
	if (typeof fields.holder !== "string") {
		throw new ValidationError(
			"PublisherCap.holder is missing or not a string",
			"publisherCap.holder",
		);
	}
	return {
		id: toPublisherCapId(object.objectId),
		publicationId: toPublicationId(fields.publication_id),
		holder: toSuiAddress(fields.holder),
	};
}

function parseOwnedPublication(
	object: SuiClientTypes.Object<{ json: true }>,
): OwnedPublication {
	const json = object.json;
	if (!json || typeof json !== "object") {
		throw new ValidationError(
			`OwnerCap ${object.objectId} has no parsed JSON content`,
			"ownerCap.json",
		);
	}
	const publicationIdRaw = (json as { publication_id?: unknown })
		.publication_id;
	if (typeof publicationIdRaw !== "string") {
		throw new ValidationError(
			"OwnerCap.publication_id is missing or not a string",
			"ownerCap.publication_id",
		);
	}
	return {
		ownerCapId: toOwnerCapId(object.objectId),
		publicationId: toPublicationId(publicationIdRaw),
	};
}

function readString(
	json: Record<string, unknown>,
	key: string,
	field: string,
): string {
	const value = json[key];
	if (typeof value !== "string") {
		throw new ValidationError(
			`Field ${field} is missing or not a string`,
			field,
		);
	}
	return value;
}

function readU8(
	json: Record<string, unknown>,
	key: string,
	field: string,
): number {
	const raw = json[key];
	const value = typeof raw === "string" ? Number(raw) : raw;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > 255
	) {
		throw new ValidationError(
			`Field ${field} is not a valid u8: ${JSON.stringify(raw)}`,
			field,
		);
	}
	return value;
}

function readSafeInteger(
	json: Record<string, unknown>,
	key: string,
	field: string,
): number {
	const raw = json[key];
	const value = typeof raw === "string" ? Number(raw) : raw;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new ValidationError(
			`Field ${field} is not a non-negative safe integer: ${JSON.stringify(raw)}`,
			field,
		);
	}
	return value;
}

/**
 * Detect the specific Sui gRPC per-object "not found" error. Matches the
 * exact `Object {id} not found` message format thrown by the batch object
 * lookup so that unrelated transport failures (timeouts, service unavailable)
 * are not misclassified as missing objects.
 */
function isObjectNotFoundError(cause: unknown, objectId: string): boolean {
	if (!(cause instanceof Error)) {
		return false;
	}
	return cause.message === `Object ${objectId} not found`;
}

function parseEntry(bcs: Uint8Array, entryId: number): Entry {
	let parsed: ReturnType<typeof EntryBcs.parse>;
	try {
		parsed = EntryBcs.parse(bcs);
	} catch (cause) {
		throw new ValidationError(
			`Failed to decode Entry BCS for id ${entryId}: ${cause instanceof Error ? cause.message : String(cause)}`,
			"entry.bcs",
			{ cause },
		);
	}
	return {
		id: entryId,
		name: parsed.name,
		revisions: parsed.revisions.map((r, i) => convertRevision(r, i)),
		draftHead:
			parsed.draft_head === null ? null : safeIntFromBig(parsed.draft_head),
		publicHead:
			parsed.public_head === null ? null : safeIntFromBig(parsed.public_head),
	};
}

function parseDynamicEntry(
	field: SuiClientTypes.DynamicFieldEntry & {
		value?: SuiClientTypes.DynamicFieldValue;
	},
): Entry {
	if (!field.value) {
		throw new ValidationError(
			`Dynamic field ${field.fieldId} returned without value despite include.value=true`,
			"dynamicField.value",
		);
	}
	let id: string;
	try {
		id = EntryIdBcs.parse(field.name.bcs);
	} catch (cause) {
		throw new ValidationError(
			`Failed to decode entry id from dynamic-field name`,
			"dynamicField.name",
			{ cause },
		);
	}
	const numericId = safeIntFromString(id);
	return parseEntry(field.value.bcs, numericId);
}

function convertRevision(
	parsed: ReturnType<typeof EntryBcs.parse>["revisions"][number],
	index: number,
): Revision {
	return {
		id: index,
		blobRef: convertBlobRef(parsed.blob_ref),
		contentType: parsed.content_type,
		encrypted: parsed.encrypted,
		accessPolicy: accessPolicyFromU8(parsed.access_policy),
		// On-chain bytes have already passed Move's `assert_valid_publisher_seal_id`
		// invariants (length, prefix, policy tag), so we brand them here without
		// re-validating client-side. This lets `Revision.sealId` flow directly into
		// `SealAdapter.decrypt` without a consumer-side cast.
		sealId:
			parsed.seal_id === null
				? null
				: (new Uint8Array(parsed.seal_id) as SealId),
		author: toSuiAddress(parsed.author),
	};
}

function convertBlobRef(
	parsed: ReturnType<typeof EntryBcs.parse>["revisions"][number]["blob_ref"],
): BlobRef {
	if (parsed.$kind === "Blob") {
		return { kind: "blob", blobObjectId: toBlobObjectId(parsed.Blob) };
	}
	return {
		kind: "quilt",
		patchId: toQuiltPatchId(new Uint8Array(parsed.QuiltPatch)),
	};
}

function safeIntFromBig(value: string): number {
	const asNumber = Number(value);
	if (!Number.isSafeInteger(asNumber) || asNumber < 0) {
		throw new ValidationError(
			`u64 value ${value} exceeds Number.MAX_SAFE_INTEGER`,
			"u64",
		);
	}
	return asNumber;
}

function safeIntFromString(value: string): number {
	return safeIntFromBig(value);
}

/**
 * Match the Sui gRPC core's "Object 0x... not found" message format. The
 * dynamic-field RPC routes through batch-getObjects under the hood and
 * surfaces the same shape. Loose substring matches misclassify transport
 * failures (e.g. "service unavailable: connection not found") as missing
 * objects.
 */
function isDynamicFieldNotFoundError(cause: unknown): boolean {
	if (!(cause instanceof Error)) {
		return false;
	}
	return /^Object 0x[0-9a-f]+ not found$/i.test(cause.message);
}

function parseTableId(value: unknown, field: string): SuiObjectId {
	if (value === null || typeof value !== "object") {
		throw new ValidationError(`Field ${field} is not an object`, field);
	}
	const id = (value as { id?: unknown }).id;
	if (typeof id === "string") {
		return toSuiObjectId(id);
	}
	if (id !== null && typeof id === "object") {
		const innerId = (id as { id?: unknown }).id;
		if (typeof innerId === "string") {
			return toSuiObjectId(innerId);
		}
	}
	throw new ValidationError(
		`Field ${field}.id is not a string or { id: string }`,
		`${field}.id`,
	);
}
