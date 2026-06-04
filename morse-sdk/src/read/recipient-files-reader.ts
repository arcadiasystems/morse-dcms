/**
 * Live object read for `RecipientFile`. Parses the shared object's JSON
 * representation into the typed `RecipientFile` record.
 *
 * RecipientFile was introduced in the v3 contract upgrade; both the type
 * filter and the move-call target paths use `config.packageId` (current
 * published-at), not `originalPackageId` (publication-modules genesis).
 */

import type { SuiClientTypes } from "@mysten/sui/client";

import type { ObjectReader } from "../clients.js";
import {
	toBlobObjectId,
	toRecipientFileId,
	toSuiAddress,
	toWalrusBlobId,
} from "../codecs.js";
import { NotFoundError, TransportError, ValidationError } from "../errors.js";
import type {
	BlobObjectId,
	PackageId,
	RecipientFile,
	RecipientFileId,
	SuiAddress,
	WalrusBlobId,
} from "../types.js";

/** Interface for reading `RecipientFile` objects. */
export interface RecipientFilesReader {
	getRecipientFile(
		id: RecipientFileId,
		signal?: AbortSignal,
	): Promise<RecipientFile>;
}

/** Configuration accepted by `RpcRecipientFilesReader.fromConfig`. */
export interface RpcRecipientFilesReaderConfig {
	readonly packageId: PackageId;
}

/** RPC-backed implementation. */
export class RpcRecipientFilesReader implements RecipientFilesReader {
	private readonly client: ObjectReader;
	private readonly packageId: PackageId;

	private constructor(client: ObjectReader, packageId: PackageId) {
		this.client = client;
		this.packageId = packageId;
	}

	static fromConfig(
		client: ObjectReader,
		config: RpcRecipientFilesReaderConfig,
	): RpcRecipientFilesReader {
		return new RpcRecipientFilesReader(client, config.packageId);
	}

	async getRecipientFile(
		id: RecipientFileId,
		signal?: AbortSignal,
	): Promise<RecipientFile> {
		const validated = toRecipientFileId(id);
		let response: Awaited<ReturnType<ObjectReader["getObject"]>>;
		try {
			response = await callClient("getObject", () =>
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
				throw new NotFoundError("recipient-file", validated, {
					cause: error.cause,
				});
			}
			throw error;
		}
		const object = response.object;
		if (!object) {
			throw new NotFoundError("recipient-file", validated);
		}
		return parseRecipientFile(object, this.packageId);
	}
}

function parseRecipientFile(
	object: SuiClientTypes.Object<{ json: true }>,
	_expectedPackageId: PackageId,
): RecipientFile {
	const json = object.json;
	if (!json) {
		throw new NotFoundError("recipient-file", object.objectId);
	}
	return {
		id: toRecipientFileId(object.objectId),
		owner: toSuiAddress(readString(json, "owner", "recipient_file.owner")),
		blobId: parseWalrusBlobIdField(json.blob_id, "recipient_file.blob_id"),
		blobObjectId: parseOptionalBlobObjectId(json.blob_object_id),
		name: readString(json, "name", "recipient_file.name"),
		contentType: readString(
			json,
			"content_type",
			"recipient_file.content_type",
		),
		size: readSafeInteger(json, "size", "recipient_file.size"),
		members: parseVecSetAddresses(json.members, "recipient_file.members"),
		createdAtMs: readSafeInteger(
			json,
			"created_at_ms",
			"recipient_file.created_at_ms",
		),
	};
}

/**
 * The Move contract stores `blob_id` as `vector<u8>` (raw 32 bytes). Sui
 * gRPC serializes byte vectors as either a base64 string OR a number array,
 * depending on the codepath. Accept both and re-encode to the canonical
 * 43-char URL-safe-base64 Walrus blob id.
 */
function parseWalrusBlobIdField(value: unknown, field: string): WalrusBlobId {
	const bytes = parseByteVector(value, field);
	if (bytes.length !== 32) {
		throw new ValidationError(
			`Field ${field} must decode to 32 bytes, got ${bytes.length}`,
			field,
		);
	}
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	const standardBase64 = btoa(binary);
	const urlSafe = standardBase64
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	return toWalrusBlobId(urlSafe);
}

function parseByteVector(value: unknown, field: string): Uint8Array {
	if (typeof value === "string") {
		const binary = atob(value);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
		return out;
	}
	if (Array.isArray(value)) {
		const out = new Uint8Array(value.length);
		for (let i = 0; i < value.length; i += 1) {
			const n =
				typeof value[i] === "string" ? Number(value[i]) : (value[i] as number);
			if (!Number.isInteger(n) || n < 0 || n > 255) {
				throw new ValidationError(
					`Field ${field}[${i}] is not a valid u8`,
					field,
				);
			}
			out[i] = n;
		}
		return out;
	}
	throw new ValidationError(
		`Field ${field} is missing or not a byte vector`,
		field,
	);
}

function parseOptionalBlobObjectId(value: unknown): BlobObjectId | null {
	// `Option<ID>` JSON shape: { vec: [] } for none, { vec: ["0x..."] } for some.
	if (value === null || value === undefined) return null;
	if (
		typeof value === "object" &&
		"vec" in (value as Record<string, unknown>)
	) {
		const vec = (value as { vec: unknown }).vec;
		if (Array.isArray(vec) && vec.length === 0) return null;
		if (Array.isArray(vec) && vec.length === 1 && typeof vec[0] === "string") {
			return toBlobObjectId(vec[0]);
		}
	}
	throw new ValidationError(
		`Field recipient_file.blob_object_id has unexpected shape: ${JSON.stringify(value)}`,
		"recipient_file.blob_object_id",
	);
}

function parseVecSetAddresses(
	value: unknown,
	field: string,
): readonly SuiAddress[] {
	// `VecSet<address>` JSON shape: { contents: ["0x...", "0x..."] }.
	if (value === null || typeof value !== "object") {
		throw new ValidationError(
			`Field ${field} is missing or not an object`,
			field,
		);
	}
	const contents = (value as { contents?: unknown }).contents;
	if (!Array.isArray(contents)) {
		throw new ValidationError(
			`Field ${field}.contents is not an array`,
			`${field}.contents`,
		);
	}
	return contents.map((entry, index) => {
		if (typeof entry !== "string") {
			throw new ValidationError(
				`Field ${field}.contents[${index}] is not a string`,
				`${field}.contents[${index}]`,
			);
		}
		return toSuiAddress(entry);
	});
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

async function callClient<T>(
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

function isObjectNotFoundError(cause: unknown, objectId: string): boolean {
	if (!(cause instanceof Error)) return false;
	const escaped = objectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^Object ${escaped} not found(\\b|$)`).test(cause.message);
}
