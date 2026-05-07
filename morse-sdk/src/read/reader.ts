/**
 * Read layer for publications: a swappable interface plus an RPC-backed
 * implementation. Future indexer implementations satisfy the same interface.
 */

import type { SuiClientTypes } from "@mysten/sui/client";

import type { ObjectReader } from "../clients.js";
import {
	storageModeFromU8,
	toOwnerCapId,
	toPublicationId,
	toSuiObjectId,
} from "../codecs.js";
import { NotFoundError, TransportError, ValidationError } from "../errors.js";
import type {
	Collection,
	OwnerCapId,
	PackageId,
	Publication,
	PublicationId,
	SuiAddress,
	SuiObjectId,
} from "../types.js";

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

/** Read-only access to publications. */
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
	const collections = parseCollections(json["collections"]);
	const revokedPublisherCapsTableId = parseTableId(
		json["revoked_publisher_caps"],
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
		entriesTableId: parseTableId(collection["entries"], `${path}.entries`),
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
