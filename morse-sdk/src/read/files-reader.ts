/**
 * RPC-backed reader for the allowlist + file modules. EncryptedFile objects
 * are shared (every successful create_*_file flow calls share_file), so
 * "list files owned by an address" is not exposed at the RPC layer — there
 * is no on-chain owner field for `listOwnedObjects` to filter on. Listing
 * accessible files requires event-based indexing; a future indexer-backed
 * implementation will expose it through this same interface.
 */

import type { SuiClientTypes } from "@mysten/sui/client";

import type { ObjectReader } from "../clients.js";
import {
	toAllowlistCapId,
	toAllowlistId,
	toBlobObjectId,
	toEncryptedFileId,
	toSuiAddress,
	toWalrusBlobId,
} from "../codecs.js";
import { NotFoundError, TransportError, ValidationError } from "../errors.js";
import type {
	Allowlist,
	AllowlistCap,
	AllowlistId,
	EncryptedFile,
	EncryptedFileId,
	PackageId,
	SuiAddress,
} from "../types.js";

const DEFAULT_PAGE_LIMIT = 50;

/** Result of a single page of `listAllowlistCapsOwnedBy`. */
export interface AllowlistCapListPage {
	readonly results: readonly AllowlistCap[];
	readonly nextCursor: string | null;
}

/** Options for paginated list calls in `FilesReader`. */
export interface FilesListOptions {
	readonly limit?: number;
	readonly cursor?: string;
	readonly signal?: AbortSignal;
}

/**
 * Read-only access to the files domain: Allowlist objects, EncryptedFile
 * metadata records, and the AllowlistCaps owned by a given address.
 *
 * Notably absent: there is no `listEncryptedFilesOwnedBy(address)` because
 * EncryptedFile is a shared object with no on-chain owner field; `address`
 * cannot index into anything. List the AllowlistCaps an address holds
 * (admin access), then fetch each cap's `allowlistId` and inspect the
 * allowlist's `members` set, or subscribe to the contract's events.
 */
export interface FilesReader {
	getAllowlist(id: AllowlistId, signal?: AbortSignal): Promise<Allowlist>;
	getEncryptedFile(
		id: EncryptedFileId,
		signal?: AbortSignal,
	): Promise<EncryptedFile>;
	listAllowlistCapsOwnedBy(
		address: SuiAddress,
		options?: FilesListOptions,
	): Promise<AllowlistCapListPage>;
}

export class RpcFilesReader implements FilesReader {
	constructor(
		private readonly client: ObjectReader,
		private readonly typePackageId: PackageId,
	) {}

	/**
	 * Build a reader from a morse package config. Uses `packageId` (the
	 * current published-at) for type filters because the allowlist + file
	 * modules were introduced in the v2 upgrade — Sui identifies a type by
	 * the package id where it was DEFINED, not by the package's genesis
	 * original-id. This differs from `RpcPublicationReader`, which uses
	 * `originalPackageId` because publication / collection / entry were
	 * defined in v1.
	 */
	static fromMorseConfig(
		config: { packageId: PackageId; originalPackageId?: PackageId },
		client: ObjectReader,
	): RpcFilesReader {
		return new RpcFilesReader(client, config.packageId);
	}

	async getAllowlist(
		id: AllowlistId,
		signal?: AbortSignal,
	): Promise<Allowlist> {
		const validated = toAllowlistId(id);
		let response: Awaited<ReturnType<ObjectReader["getObject"]>>;
		try {
			response = await this.callClient("getObject", () =>
				this.client.getObject({
					objectId: validated,
					include: { json: true },
					...(signal === undefined ? {} : { signal }),
				}),
			);
		} catch (error) {
			if (
				error instanceof TransportError &&
				isObjectNotFoundError(error.cause, validated)
			) {
				throw new NotFoundError("allowlist", validated, {
					cause: error.cause,
				});
			}
			throw error;
		}
		const object = response.object;
		if (!object) {
			throw new NotFoundError("allowlist", validated);
		}
		return parseAllowlist(object);
	}

	async getEncryptedFile(
		id: EncryptedFileId,
		signal?: AbortSignal,
	): Promise<EncryptedFile> {
		const validated = toEncryptedFileId(id);
		let response: Awaited<ReturnType<ObjectReader["getObject"]>>;
		try {
			response = await this.callClient("getObject", () =>
				this.client.getObject({
					objectId: validated,
					include: { json: true },
					...(signal === undefined ? {} : { signal }),
				}),
			);
		} catch (error) {
			if (
				error instanceof TransportError &&
				isObjectNotFoundError(error.cause, validated)
			) {
				throw new NotFoundError("encrypted-file", validated, {
					cause: error.cause,
				});
			}
			throw error;
		}
		const object = response.object;
		if (!object) {
			throw new NotFoundError("encrypted-file", validated);
		}
		return parseEncryptedFile(object);
	}

	async listAllowlistCapsOwnedBy(
		address: SuiAddress,
		options: FilesListOptions = {},
	): Promise<AllowlistCapListPage> {
		const validated = toSuiAddress(address);
		const { limit = DEFAULT_PAGE_LIMIT, cursor, signal } = options;
		const capType = `${this.typePackageId}::allowlist::Cap`;
		const response = await this.callClient("listOwnedObjects", () =>
			this.client.listOwnedObjects({
				owner: validated,
				type: capType,
				limit,
				cursor: cursor ?? null,
				include: { json: true },
				...(signal === undefined ? {} : { signal }),
			}),
		);
		const results = response.objects.map((object) => parseAllowlistCap(object));
		return { results, nextCursor: response.cursor };
	}

	private async callClient<T>(
		operation: string,
		call: () => Promise<T>,
	): Promise<T> {
		try {
			return await call();
		} catch (cause) {
			throw new TransportError(`${operation} failed`, {
				cause,
				operation: `sui.${operation}`,
			});
		}
	}
}

function parseAllowlist(
	object: SuiClientTypes.Object<{ json: true }>,
): Allowlist {
	const json = object.json;
	if (!json || typeof json !== "object") {
		throw new NotFoundError("allowlist", object.objectId);
	}
	const record = json as Record<string, unknown>;
	const name = readString(record, "name", "allowlist.name");
	const members = readMembers(record);
	return {
		id: toAllowlistId(object.objectId),
		name,
		members,
	};
}

function parseAllowlistCap(
	object: SuiClientTypes.Object<{ json: true }>,
): AllowlistCap {
	const json = object.json;
	if (!json || typeof json !== "object") {
		throw new NotFoundError("allowlist", object.objectId);
	}
	const record = json as Record<string, unknown>;
	const allowlistIdField = record.allowlist_id;
	if (typeof allowlistIdField !== "string") {
		throw new ValidationError(
			"allowlist::Cap.allowlist_id missing or not a string",
			"cap.allowlist_id",
		);
	}
	return {
		id: toAllowlistCapId(object.objectId),
		allowlistId: toAllowlistId(allowlistIdField),
	};
}

function parseEncryptedFile(
	object: SuiClientTypes.Object<{ json: true }>,
): EncryptedFile {
	const json = object.json;
	if (!json || typeof json !== "object") {
		throw new NotFoundError("encrypted-file", object.objectId);
	}
	const record = json as Record<string, unknown>;
	const owner = toSuiAddress(readString(record, "owner", "file.owner"));
	// Sui gRPC serializes vector<u8> either as a base64 string (standard JSON
	// representation) or as a number array (older RPC variants). Accept both.
	const blobId = toWalrusBlobId(parseBlobIdField(record.blob_id));
	const blobObjectId = readOptionalString(record, "blob_object_id");
	const name = readString(record, "name", "file.name");
	const contentType = readString(record, "content_type", "file.content_type");
	const size = readSafeIntFromBig(record, "size", "file.size");
	const encrypted = record.encrypted === true;
	const allowlistIdRaw = readOptionalString(record, "allowlist_id");
	const createdAtMs = readSafeIntFromBig(
		record,
		"created_at_ms",
		"file.created_at_ms",
	);
	return {
		id: toEncryptedFileId(object.objectId),
		owner,
		blobId,
		blobObjectId: blobObjectId === null ? null : toBlobObjectId(blobObjectId),
		name,
		contentType,
		size,
		encrypted,
		allowlistId: allowlistIdRaw === null ? null : toAllowlistId(allowlistIdRaw),
		createdAtMs,
	};
}

function readMembers(record: Record<string, unknown>): readonly SuiAddress[] {
	const raw = record.members;
	if (!raw || typeof raw !== "object") {
		return [];
	}
	const contents = (raw as { contents?: unknown }).contents;
	if (!Array.isArray(contents)) {
		return [];
	}
	const out: SuiAddress[] = [];
	for (const entry of contents) {
		if (typeof entry === "string") {
			out.push(toSuiAddress(entry));
		}
	}
	return out;
}

function readString(
	record: Record<string, unknown>,
	field: string,
	errorField: string,
): string {
	const value = record[field];
	if (typeof value !== "string") {
		throw new ValidationError(
			`${errorField} missing or not a string`,
			errorField,
		);
	}
	return value;
}

function readOptionalString(
	record: Record<string, unknown>,
	field: string,
): string | null {
	const value = record[field];
	if (value === null || value === undefined) {
		return null;
	}
	return typeof value === "string" ? value : null;
}

function readSafeIntFromBig(
	record: Record<string, unknown>,
	field: string,
	errorField: string,
): number {
	const value = record[field];
	if (typeof value !== "string" && typeof value !== "number") {
		throw new ValidationError(
			`${errorField} missing or not a number`,
			errorField,
		);
	}
	const big = BigInt(value as string | number);
	if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new ValidationError(
			`${errorField} exceeds Number.MAX_SAFE_INTEGER`,
			errorField,
		);
	}
	return Number(big);
}

function bytesArrayToBase64Url(bytes: number[]): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	const b64 = btoa(binary);
	return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Sui gRPC may serialize `vector<u8>` as:
 *   - a base64 string (standard JSON encoding)
 *   - a base64URL string (some RPC variants)
 *   - an array of numbers (older variants, or when the field is small)
 * Return the URL-safe-base64 form Walrus uses for blob ids regardless of input shape.
 */
function parseBlobIdField(raw: unknown): string {
	if (Array.isArray(raw)) {
		return bytesArrayToBase64Url(raw as number[]);
	}
	if (typeof raw !== "string") {
		throw new ValidationError(
			"file.blob_id must be a byte array or base64 string",
			"file.blob_id",
		);
	}
	// Already URL-safe? Strip padding and return.
	if (/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) {
		return raw.replace(/=+$/g, "");
	}
	// Standard base64 with + and / — convert to URL-safe.
	if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
		return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
	}
	throw new ValidationError(
		"file.blob_id is not a recognized base64 string",
		"file.blob_id",
	);
}

function isObjectNotFoundError(cause: unknown, _objectId: string): boolean {
	if (!(cause instanceof Error)) {
		return false;
	}
	return /not found|NotFound|object.*not.*exist/i.test(cause.message);
}
