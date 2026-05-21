/**
 * `WalrusWriteAdapter` that uploads through a Walrus publisher HTTP service
 * instead of fanning out to ~30 storage nodes via `WalrusClient`. The
 * publisher (an operator-run service) pays the WAL storage deposit and
 * handles `register_blob` + `certify_blob` server-side; the consumer's
 * wallet only signs the downstream `add_entry_to_collection` (1 popup).
 *
 * Trade-offs vs `DefaultWalrusWriteAdapter`:
 *   - 1 wallet popup vs 2 (the publisher absorbs register + certify).
 *   - Operator-paid storage vs consumer-paid storage. Consumers using a
 *     paid publisher tier sign whatever auth the publisher requires via
 *     the `headers` option.
 *   - The publisher returns the blob object owned by `ownerAddress` (via
 *     `send_object_to`), which the consumer then references in
 *     `addEntry`.
 *
 * NOT compatible with `addEntryFromBytes` / `addEncryptedEntryFromBytes`,
 * which require `WalrusFlowCapable` for the 2-popup combined PTB. The
 * publisher-paid path is naturally a 1-popup path through the standard
 * `uploadBlob` + `addEntry` composition; the from-bytes optimization
 * isn't needed because there's no certify popup to combine.
 */

import { toBlobObjectId, toWalrusBlobId } from "../codecs.js";
import { TransportError, ValidationError } from "../errors.js";
import type { BlobObjectId, SuiAddress, WalrusBlobId } from "../types.js";
import type {
	QuiltPatchInput,
	UploadBlobOptions,
	UploadBlobResult,
	UploadQuiltOptions,
	UploadQuiltPatch,
	UploadQuiltResult,
	WalrusWriteAdapter,
} from "./adapter.js";
import {
	decodeQuiltPatchId,
	quiltPatchIdFromString,
} from "./quilt-patch-id.js";

/** Minimal `fetch` shape the adapter calls; `globalThis.fetch` satisfies it. */
type FetchLike = (
	input: string,
	init?: {
		method?: string;
		body?: BodyInit;
		headers?: HeadersInit;
		signal?: AbortSignal;
	},
) => Promise<{
	ok: boolean;
	status: number;
	statusText: string;
	text(): Promise<string>;
	json(): Promise<unknown>;
}>;

/**
 * Custom response parser for non-standard publishers. Receives the raw
 * decoded JSON from `PUT /v1/blobs` (or the inner `blobStoreResult` field
 * on the quilt endpoint) and returns the parsed `UploadBlobResult`.
 *
 * Throw `ValidationError` for malformed shapes; throw `TransportError` for
 * content-level publisher errors that the consumer should surface (e.g.
 * `markedInvalid`, `alreadyCertified` without an owned object). Throws
 * propagate verbatim so the consumer's typed errors reach the caller of
 * `uploadBlob` / `uploadQuilt` unchanged.
 *
 * Use this when a fork of the Walrus publisher serves a response shape
 * that the built-in parser does not recognize (the built-in handles
 * Mysten's published binary, which serves camelCase, with a snake_case
 * fallback for the documented schema). Most consumers do not need to set
 * this.
 */
export type ParsePublisherResponse = (
	raw: unknown,
) => UploadBlobResult | Promise<UploadBlobResult>;

/** Construction options for `HttpPublisherWriteAdapter`. */
export interface HttpPublisherWriteAdapterOptions {
	/** Publisher base URL, e.g. `"https://walrus-testnet-publisher.nami.cloud"`. No trailing slash. */
	readonly publisherUrl: string;
	/**
	 * Address that will own the resulting Sui blob object. The publisher
	 * sends the newly-created `Blob` to this address via `send_object_to`
	 * so the consumer's `addEntry` can reference it. Typically the
	 * connected wallet's address.
	 */
	readonly ownerAddress: SuiAddress;
	/** Optional per-request HTTP headers (auth tokens, bearer keys, custom origin labels). */
	readonly headers?: HeadersInit;
	/** Override `fetch` for testing; defaults to `globalThis.fetch`. */
	readonly fetch?: FetchLike;
	/**
	 * Optional response-shape escape hatch for non-standard publishers. When
	 * supplied, replaces the built-in parser. See `ParsePublisherResponse`
	 * for the contract. Most consumers should leave this undefined.
	 */
	readonly parseResponse?: ParsePublisherResponse;
}

/**
 * Subset of the publisher's `BlobStoreResult` we parse. Field names use
 * camelCase to match the live publisher JSON (the OpenAPI spec at
 * `$PUBLISHER/v1/api` documents snake_case but the running services serve
 * camelCase). Snake_case aliases are accepted as a fallback in case future
 * publisher versions or operators normalize differently.
 */
interface BlobStoreResultLike {
	readonly alreadyCertified?: {
		readonly blobId?: string;
		readonly blob_id?: string;
		readonly object?: string;
		readonly endEpoch?: number;
		readonly end_epoch?: number;
	};
	readonly newlyCreated?: {
		readonly blobObject?: BlobObjectLike;
		readonly blob_object?: BlobObjectLike;
	};
	readonly markedInvalid?: {
		readonly blobId?: string;
		readonly blob_id?: string;
	};
	readonly error?: {
		readonly errorMsg?: string;
		readonly error_msg?: string;
		readonly blobId?: string;
		readonly blob_id?: string;
	};
}

interface BlobObjectLike {
	readonly id?: string;
	readonly blobId?: string;
	readonly blob_id?: string;
}

interface QuiltStoreResultLike {
	readonly blobStoreResult?: BlobStoreResultLike;
	readonly storedQuiltBlobs?: ReadonlyArray<{
		readonly identifier?: string;
		readonly quiltPatchId?: string;
	}>;
}

/**
 * `WalrusWriteAdapter` backed by a Walrus publisher HTTP service. Substitutes
 * an operator-run upload service for the direct-protocol shard fanout.
 * Useful for browser dapps that want a "publisher pays storage" onboarding
 * path (1 wallet popup total) and/or CORS-friendly uploads from environments
 * that block direct storage-node fanout.
 */
export class HttpPublisherWriteAdapter implements WalrusWriteAdapter {
	readonly #publisherUrl: string;
	readonly #ownerAddress: SuiAddress;
	readonly #headers?: HeadersInit;
	readonly #fetch: FetchLike;
	readonly #parseResponse?: ParsePublisherResponse;

	constructor(options: HttpPublisherWriteAdapterOptions) {
		this.#publisherUrl = options.publisherUrl.replace(/\/+$/, "");
		this.#ownerAddress = options.ownerAddress;
		if (options.headers !== undefined) this.#headers = options.headers;
		// Browsers enforce that `window.fetch` is called with `window` as its
		// receiver (WebIDL HostObject check); storing `globalThis.fetch` on
		// the instance and calling it as `this.#fetch(...)` later throws
		// `TypeError: Illegal invocation`. Bind to `globalThis` so the call
		// receiver is correct in browsers. Node's fetch is bind-tolerant so
		// CLI smokes did not surface this regression; the regression test
		// in this file's `default fetch binding` describe block does.
		this.#fetch =
			options.fetch ?? (globalThis.fetch.bind(globalThis) as FetchLike);
		if (options.parseResponse !== undefined) {
			this.#parseResponse = options.parseResponse;
		}
	}

	/** Mirror `DefaultWalrusWriteAdapter.fromConfig` for symmetry. */
	static fromConfig(
		options: HttpPublisherWriteAdapterOptions,
	): HttpPublisherWriteAdapter {
		return new HttpPublisherWriteAdapter(options);
	}

	async uploadBlob(
		data: Uint8Array,
		options: UploadBlobOptions,
	): Promise<UploadBlobResult> {
		if (data.length === 0) {
			throw new ValidationError("uploadBlob requires non-empty bytes", "blob");
		}
		if (!Number.isInteger(options.epochs) || options.epochs < 1) {
			throw new ValidationError(
				`uploadBlob.epochs must be a positive integer; got ${options.epochs}`,
				"epochs",
			);
		}
		const url = this.buildBlobUrl(options);
		const result = await this.putRequest<unknown>(
			url,
			data as unknown as BodyInit,
			options.signal,
			"walrus.publisher.uploadBlob",
		);
		return this.#parseResponse !== undefined
			? await this.#parseResponse(result)
			: parseBlobStoreResult(
					result as BlobStoreResultLike,
					"walrus.publisher.uploadBlob",
				);
	}

	async uploadQuilt(
		patches: readonly QuiltPatchInput[],
		options: UploadQuiltOptions,
	): Promise<UploadQuiltResult> {
		if (patches.length === 0) {
			throw new ValidationError(
				"uploadQuilt requires at least one patch",
				"patches",
			);
		}
		if (!Number.isInteger(options.epochs) || options.epochs < 1) {
			throw new ValidationError(
				`uploadQuilt.epochs must be a positive integer; got ${options.epochs}`,
				"epochs",
			);
		}

		const form = new FormData();
		const metadata: Array<{
			identifier: string;
			tags?: Record<string, string>;
		}> = [];
		for (const patch of patches) {
			if (patch.identifier.length === 0) {
				throw new ValidationError(
					"Quilt patch identifier must not be empty",
					"patches[].identifier",
				);
			}
			// Publisher API treats each form field name as the patch identifier and
			// the field's bytes as the patch content. File-style multipart entries
			// (a Blob with type `application/octet-stream`) are universally accepted
			// by the publisher's multer-style parser.
			const blob = new Blob([patch.contents as unknown as BlobPart], {
				type: "application/octet-stream",
			});
			form.append(patch.identifier, blob, patch.identifier);
			if (patch.tags !== undefined && Object.keys(patch.tags).length > 0) {
				metadata.push({
					identifier: patch.identifier,
					tags: { ...patch.tags },
				});
			} else {
				metadata.push({ identifier: patch.identifier });
			}
		}
		form.append("_metadata", JSON.stringify(metadata));

		const url = this.buildQuiltUrl(options);
		const result = await this.putRequest<QuiltStoreResultLike>(
			url,
			form as unknown as BodyInit,
			options.signal,
			"walrus.publisher.uploadQuilt",
		);

		if (result.blobStoreResult === undefined) {
			throw new TransportError(
				"Walrus publisher quilt response missing blobStoreResult field",
				{ operation: "walrus.publisher.uploadQuilt" },
			);
		}
		// The outer QuiltStoreResult envelope (blobStoreResult + storedQuiltBlobs)
		// is parsed by the built-in path. The inner blobStoreResult is the same
		// shape as the blob endpoint, so it routes through the custom parser
		// when one is set — that lets consumers normalize the same way for both
		// upload paths.
		const parent =
			this.#parseResponse !== undefined
				? await this.#parseResponse(result.blobStoreResult)
				: parseBlobStoreResult(
						result.blobStoreResult,
						"walrus.publisher.uploadQuilt",
					);
		const storedPatches = result.storedQuiltBlobs ?? [];
		const patchesOut: UploadQuiltPatch[] = storedPatches.map((p) => {
			if (
				typeof p.identifier !== "string" ||
				typeof p.quiltPatchId !== "string"
			) {
				throw new ValidationError(
					"Walrus publisher storedQuiltBlobs entry missing identifier or quiltPatchId",
					"quilt.storedQuiltBlobs",
				);
			}
			return {
				identifier: p.identifier,
				patchId: quiltPatchIdFromString(p.quiltPatchId),
				// The publisher exposes a `range` but the contract reads
				// startIndex/endIndex from the patchId itself; decode for symmetry
				// with `DefaultWalrusWriteAdapter`'s result shape.
				...decodeStartEndFromPatchId(p.quiltPatchId),
			};
		});

		return {
			blobId: parent.blobId,
			blobObjectId: parent.blobObjectId,
			patches: patchesOut,
		};
	}

	private buildBlobUrl(options: UploadBlobOptions): string {
		const params = new URLSearchParams();
		params.set("epochs", String(options.epochs));
		params.set("send_object_to", options.owner ?? this.#ownerAddress);
		// `deletable` query param is deprecated as of publisher v1.33+ (blobs
		// are deletable by default). Send `permanent=false` only when the
		// caller explicitly asks for a non-deletable blob — the Move layer
		// rejects non-deletable blobs so this branch is effectively unreachable
		// from morse-sdk's ops, but the adapter respects the option.
		if (options.deletable === false) {
			params.set("permanent", "true");
		}
		return `${this.#publisherUrl}/v1/blobs?${params.toString()}`;
	}

	private buildQuiltUrl(options: UploadQuiltOptions): string {
		const params = new URLSearchParams();
		params.set("epochs", String(options.epochs));
		params.set("send_object_to", options.owner ?? this.#ownerAddress);
		if (options.deletable === false) {
			params.set("permanent", "true");
		}
		return `${this.#publisherUrl}/v1/quilts?${params.toString()}`;
	}

	private async putRequest<T>(
		url: string,
		body: BodyInit,
		signal: AbortSignal | undefined,
		operation: string,
	): Promise<T> {
		let response: Awaited<ReturnType<FetchLike>>;
		try {
			response = await this.#fetch(url, {
				method: "PUT",
				body,
				...(this.#headers === undefined ? {} : { headers: this.#headers }),
				...(signal === undefined ? {} : { signal }),
			});
		} catch (cause) {
			throw new TransportError(
				`Walrus publisher request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause, operation },
			);
		}
		if (!response.ok) {
			let detail = "";
			try {
				detail = await response.text();
			} catch {
				// ignore body-read failures; surface the status code anyway.
			}
			throw new TransportError(
				`Walrus publisher returned HTTP ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`,
				{ operation },
			);
		}
		try {
			return (await response.json()) as T;
		} catch (cause) {
			throw new TransportError(
				`Walrus publisher response is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause, operation },
			);
		}
	}
}

function parseBlobStoreResult(
	result: BlobStoreResultLike,
	operation: string,
): UploadBlobResult {
	if (result.newlyCreated !== undefined) {
		const blob =
			result.newlyCreated.blobObject ?? result.newlyCreated.blob_object;
		const blobIdField = blob?.blobId ?? blob?.blob_id;
		if (
			blob === undefined ||
			typeof blob.id !== "string" ||
			typeof blobIdField !== "string"
		) {
			throw new ValidationError(
				"Walrus publisher newlyCreated response missing blobObject.id or blobObject.blobId",
				"blobObject",
			);
		}
		return {
			blobId: toWalrusBlobId(blobIdField),
			blobObjectId: toBlobObjectId(blob.id),
		};
	}
	if (result.alreadyCertified !== undefined) {
		const ac = result.alreadyCertified;
		const blobIdField = ac.blobId ?? ac.blob_id;
		if (typeof blobIdField !== "string") {
			throw new ValidationError(
				"Walrus publisher alreadyCertified response missing blobId",
				"alreadyCertified",
			);
		}
		if (typeof ac.object !== "string") {
			// The publisher returned an event-id reference (no object) — the blob
			// was already certified by another party, no Sui object exists for our
			// address. morse-sdk consumers need a `blobObjectId` to attach in
			// `addEntry`; surface this as a transport-layer issue with an
			// actionable hint.
			throw new TransportError(
				"Walrus publisher reports the blob is already certified by another party; no owned Sui object is available. Pass `force=true` as a query param (via custom headers escape hatch or a forked adapter), or compose with `DefaultWalrusWriteAdapter` if you need to register your own Blob object.",
				{ operation },
			);
		}
		return {
			blobId: toWalrusBlobId(blobIdField),
			blobObjectId: toBlobObjectId(ac.object),
		};
	}
	if (result.markedInvalid !== undefined) {
		const id =
			result.markedInvalid.blobId ??
			result.markedInvalid.blob_id ??
			"(unknown)";
		throw new TransportError(
			`Walrus publisher returned markedInvalid for blob ${id}; the blob is known to Walrus but was rejected (storage-node bug, malicious quorum, or invalid encoding).`,
			{ operation },
		);
	}
	if (result.error !== undefined) {
		const message =
			result.error.errorMsg ?? result.error.error_msg ?? "(no message)";
		throw new TransportError(`Walrus publisher returned error: ${message}`, {
			operation,
		});
	}
	throw new TransportError(
		"Walrus publisher response did not match newlyCreated / alreadyCertified / markedInvalid / error",
		{ operation },
	);
}

/**
 * Quilt patch ids encode `{quiltBlobId, version, startIndex, endIndex}`. Decode
 * via the existing structural codec to surface `startIndex`/`endIndex` in
 * the upload result, matching `DefaultWalrusWriteAdapter`'s shape.
 */
function decodeStartEndFromPatchId(value: string): {
	startIndex: number;
	endIndex: number;
} {
	const patchId = quiltPatchIdFromString(value);
	const parts = decodeQuiltPatchId(patchId);
	return { startIndex: parts.startIndex, endIndex: parts.endIndex };
}

// Re-export `BlobObjectId` / `WalrusBlobId` types referenced in JSDoc above.
export type { BlobObjectId, WalrusBlobId };
