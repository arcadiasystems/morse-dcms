/**
 * `WalrusReadAdapter` that fetches blob bytes from a Walrus aggregator HTTP
 * service instead of fanning out to ~30 storage nodes via `WalrusClient`.
 *
 * Why this exists: browser reads through `DefaultWalrusReadAdapter` hit the
 * direct-protocol path, which fans out to every storage node in the
 * committee. On testnet a subset of those nodes do not ship CORS headers,
 * so browser fetches frequently fail with `NoBlobMetadataReceivedError`
 * even when the blob is healthy. CLI smokes against the same blob succeed
 * because the CLI does not enforce CORS. The aggregator HTTP service is a
 * Walrus-operator-run wrapper that internally does the shard math and
 * exposes a single CORS-friendly endpoint.
 *
 * Trust model: the aggregator returns whatever bytes it serves. The
 * trustless guarantee of fanout-and-reconstruct is replaced with trust in
 * the operator. Most consumers running a known Mysten / Nami / community
 * aggregator are fine with this; consumers who need stronger guarantees
 * should keep `DefaultWalrusReadAdapter`. A future `verifyContentHash`
 * option is planned for v0.2.0 to recompute the blobId from returned bytes
 * and assert it matches.
 *
 * On-chain Sui object lookups (resolving `blobObjectId` to its `blob_id`)
 * still go through the supplied `ObjectReader` (gRPC). The HTTP path only
 * substitutes the bytes-fetch step.
 */

import { blobIdFromInt } from "@mysten/walrus";

import type { ObjectReader } from "../clients.js";
import { toWalrusBlobId } from "../codecs.js";
import type { NetworkConfig } from "../config.js";
import {
	ConfigurationError,
	NotFoundError,
	TransportError,
	ValidationError,
} from "../errors.js";
import type {
	BlobObjectId,
	BlobRef,
	QuiltPatchId,
	WalrusBlobId,
} from "../types.js";
import type {
	WalrusReadAdapter,
	WalrusReadOptions,
} from "./default-read-adapter.js";
import { quiltPatchIdToString } from "./quilt-patch-id.js";

/** Minimal `fetch` shape the adapter calls; `globalThis.fetch` satisfies it. */
type FetchLike = (
	input: string,
	init?: { signal?: AbortSignal; headers?: HeadersInit },
) => Promise<{
	ok: boolean;
	status: number;
	statusText: string;
	arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * Optional integrity check on blob bytes received from the aggregator. The
 * callback is invoked with the bytes and the expected `blobId` after every
 * successful blob fetch (`readBlob` and `readBlobByObjectId`). It must
 * throw on a mismatch; the adapter rewraps the throw as a `TransportError`
 * so consumers narrow on the SDK's error taxonomy.
 *
 * Why a callback: Walrus's `blobId` is derived from the encoded blob (Reed-
 * Solomon slivers, root hash), not a simple `blake2b256(bytes)`. Computing
 * the canonical blobId from raw bytes requires `WalrusClient.computeBlobMetadata`
 * with the committee's `numShards`. The SDK keeps this as a callback rather
 * than a built-in option to avoid coupling the lightweight HTTP adapter to
 * a `WalrusClient` instance and its `numShards` lookup.
 *
 * Quilt patches are not verified: `readQuiltPatch` returns a sub-range of
 * a parent blob, and per-patch hashes are not part of the canonical
 * patch-id derivation at this version of Walrus.
 */
export type WalrusBlobIntegrityCheck = (
	bytes: Uint8Array,
	expectedBlobId: WalrusBlobId,
) => Promise<void>;

/** Construction options for `HttpAggregatorReadAdapter`. */
export interface HttpAggregatorReadAdapterOptions {
	/** Aggregator base URL, e.g. `"https://aggregator.walrus-testnet.walrus.space"`. No trailing slash. */
	readonly aggregatorUrl: string;
	/** Sui RPC client used to resolve `blobObjectId` to `blob_id` for `readBlobByObjectId`. */
	readonly suiClient: ObjectReader;
	/** Optional per-request HTTP headers (auth tokens, custom origin labels). */
	readonly headers?: HeadersInit;
	/** Override `fetch` for testing; defaults to `globalThis.fetch`. */
	readonly fetch?: FetchLike;
	/**
	 * Optional trust-but-verify callback. When supplied, blob fetches verify
	 * the returned bytes match the expected `blobId` before resolving. Wire
	 * this to `WalrusClient.computeBlobMetadata({ bytes, numShards }).blobId`
	 * if you want the canonical Walrus derivation; or implement a custom
	 * application-level check.
	 */
	readonly verifyBlobIntegrity?: WalrusBlobIntegrityCheck;
}

/**
 * `WalrusReadAdapter` backed by a Walrus aggregator HTTP service.
 * Substitutes one CORS-friendly server for the direct-protocol fanout that
 * misbehaves on testnet from browsers. Trade trustless reads for operator
 * trust; pick `DefaultWalrusReadAdapter` if you need the former.
 */
export class HttpAggregatorReadAdapter implements WalrusReadAdapter {
	readonly #aggregatorUrl: string;
	readonly #suiClient: ObjectReader;
	readonly #headers?: HeadersInit;
	readonly #fetch: FetchLike;
	readonly #verifyBlobIntegrity?: WalrusBlobIntegrityCheck;

	constructor(options: HttpAggregatorReadAdapterOptions) {
		this.#aggregatorUrl = options.aggregatorUrl.replace(/\/+$/, "");
		this.#suiClient = options.suiClient;
		if (options.headers !== undefined) this.#headers = options.headers;
		// Browsers enforce that `window.fetch` is called with `window` as its
		// receiver (WebIDL HostObject check); storing `globalThis.fetch` on
		// the instance and calling it as `this.#fetch(...)` later throws
		// `TypeError: Illegal invocation`. Bind to `globalThis` so the call
		// receiver is correct in browsers.
		this.#fetch =
			options.fetch ?? (globalThis.fetch.bind(globalThis) as FetchLike);
		if (options.verifyBlobIntegrity !== undefined) {
			this.#verifyBlobIntegrity = options.verifyBlobIntegrity;
		}
	}

	/** Mirror `DefaultWalrusReadAdapter.fromConfig` for symmetry. */
	static fromConfig(
		options: HttpAggregatorReadAdapterOptions,
	): HttpAggregatorReadAdapter {
		return new HttpAggregatorReadAdapter(options);
	}

	/**
	 * Construct against `morseConfig.walrusEndpoints.aggregator` (the canonical
	 * Mysten-run aggregator for the network). Pass `verifyBlobIntegrity` or
	 * `headers` here if you want them; everything else is inferred.
	 *
	 * @throws {ConfigurationError} If the network has no canonical aggregator
	 *   URL (e.g. mainnet pre-freeze, or a custom-deployment config without
	 *   `walrusEndpoints.aggregator` supplied).
	 */
	static fromMorseConfig(
		morseConfig: Pick<NetworkConfig, "walrusEndpoints">,
		suiClient: ObjectReader,
		extras?: Pick<
			HttpAggregatorReadAdapterOptions,
			"headers" | "fetch" | "verifyBlobIntegrity"
		>,
	): HttpAggregatorReadAdapter {
		const url = morseConfig.walrusEndpoints?.aggregator ?? "";
		if (url.length === 0) {
			throw new ConfigurationError(
				"morseConfig.walrusEndpoints.aggregator is empty. Pass an aggregator URL explicitly to HttpAggregatorReadAdapter.fromConfig({ aggregatorUrl, suiClient }), or use a network where the endpoint is pinned (testnet).",
			);
		}
		return new HttpAggregatorReadAdapter({
			aggregatorUrl: url,
			suiClient,
			...(extras?.headers === undefined ? {} : { headers: extras.headers }),
			...(extras?.fetch === undefined ? {} : { fetch: extras.fetch }),
			...(extras?.verifyBlobIntegrity === undefined
				? {}
				: { verifyBlobIntegrity: extras.verifyBlobIntegrity }),
		});
	}

	async readBlob(
		blobId: WalrusBlobId,
		options: WalrusReadOptions = {},
	): Promise<Uint8Array> {
		const url = `${this.#aggregatorUrl}/v1/blobs/${encodeURIComponent(blobId)}`;
		const bytes = await this.fetchBytes(url, "blob", blobId, options.signal);
		if (this.#verifyBlobIntegrity !== undefined) {
			try {
				await this.#verifyBlobIntegrity(bytes, blobId);
			} catch (cause) {
				throw new TransportError(
					`Walrus aggregator returned bytes that fail blob-integrity check for ${blobId}: ${cause instanceof Error ? cause.message : String(cause)}`,
					{ cause, operation: "walrus.aggregator.readBlob" },
				);
			}
		}
		return bytes;
	}

	async readBlobByObjectId(
		blobObjectId: BlobObjectId,
		options: WalrusReadOptions = {},
	): Promise<Uint8Array> {
		const blobId = await this.resolveBlobIdFromObject(
			blobObjectId,
			options.signal,
		);
		return this.readBlob(blobId, options);
	}

	async readQuiltPatch(
		patchId: QuiltPatchId,
		options: WalrusReadOptions = {},
	): Promise<Uint8Array> {
		const id = quiltPatchIdToString(patchId);
		const url = `${this.#aggregatorUrl}/v1/blobs/by-quilt-patch-id/${encodeURIComponent(id)}`;
		return this.fetchBytes(url, "quilt patch", id, options.signal);
	}

	async readBlobRef(
		blobRef: BlobRef,
		options: WalrusReadOptions = {},
	): Promise<Uint8Array> {
		if (blobRef.kind === "blob") {
			return this.readBlobByObjectId(blobRef.blobObjectId, options);
		}
		return this.readQuiltPatch(blobRef.patchId, options);
	}

	private async fetchBytes(
		url: string,
		kind: "blob" | "quilt patch",
		identifier: string,
		signal: AbortSignal | undefined,
	): Promise<Uint8Array> {
		const operation =
			kind === "blob"
				? "walrus.aggregator.readBlob"
				: "walrus.aggregator.readQuiltPatch";
		let response: Awaited<ReturnType<FetchLike>>;
		try {
			response = await this.#fetch(url, {
				...(signal === undefined ? {} : { signal }),
				...(this.#headers === undefined ? {} : { headers: this.#headers }),
			});
		} catch (cause) {
			throw new TransportError(
				`Walrus aggregator request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause, operation },
			);
		}

		if (response.status === 404) {
			throw new NotFoundError(
				"blob",
				`Walrus aggregator: ${kind} ${identifier} not found`,
				{ cause: new Error(`HTTP ${response.status} ${response.statusText}`) },
			);
		}
		if (!response.ok) {
			throw new TransportError(
				`Walrus aggregator returned HTTP ${response.status} ${response.statusText} for ${kind} ${identifier}`,
				{ operation },
			);
		}

		try {
			const buffer = await response.arrayBuffer();
			return new Uint8Array(buffer);
		} catch (cause) {
			throw new TransportError(
				`Walrus aggregator response body could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause, operation },
			);
		}
	}

	private async resolveBlobIdFromObject(
		blobObjectId: BlobObjectId,
		signal: AbortSignal | undefined,
	): Promise<WalrusBlobId> {
		let response: Awaited<ReturnType<ObjectReader["getObject"]>>;
		try {
			response = await this.#suiClient.getObject({
				objectId: blobObjectId,
				include: { json: true },
				...(signal === undefined ? {} : { signal }),
			});
		} catch (cause) {
			throw new TransportError(
				`Sui getObject failed for blob ${blobObjectId}: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause, operation: "sui.getObject" },
			);
		}
		const object = response.object;
		if (object === undefined || object === null) {
			throw new NotFoundError(
				"blob",
				`Walrus blob object not found on-chain: ${blobObjectId}`,
			);
		}
		const json = object.json;
		if (json === null || typeof json !== "object") {
			throw new ValidationError(
				`Walrus blob object ${blobObjectId} has no parsed JSON content`,
				"blob.json",
			);
		}
		const blobIdRaw = (json as { blob_id?: unknown }).blob_id;
		if (typeof blobIdRaw !== "string" && typeof blobIdRaw !== "number") {
			throw new ValidationError(
				`Walrus blob object ${blobObjectId} has no string blob_id field; got ${typeof blobIdRaw}`,
				"blob.blob_id",
			);
		}
		// Move `u256` BCS-decodes to a decimal string in Sui RPC json mode;
		// `blobIdFromInt` converts it to the URL-safe-base64 form aggregators expect.
		try {
			const asBigInt = BigInt(blobIdRaw);
			return toWalrusBlobId(blobIdFromInt(asBigInt));
		} catch (cause) {
			throw new ValidationError(
				`Walrus blob_id u256 could not be converted to base64: ${cause instanceof Error ? cause.message : String(cause)}`,
				"blob.blob_id",
				{ cause },
			);
		}
	}
}
