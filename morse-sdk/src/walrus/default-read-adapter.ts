/**
 * Read-side counterpart to `DefaultWalrusWriteAdapter`. Wraps
 * `@mysten/walrus`'s read APIs (`readBlob`, `getBlobObject`, `getFiles`)
 * behind an interface symmetric to the write adapter.
 *
 * Without this, browser dapps that need to fetch raw blob bytes (most
 * commonly: encrypted-entry decryption flows that read ciphertext from
 * Walrus before passing it to `seal.decrypt`) end up instantiating
 * `WalrusClient` directly, defeating the adapter pattern.
 */

import {
	BlobNotCertifiedError,
	WalrusClient,
	type WalrusClientConfig,
	type WalrusFile,
	NotFoundError as WalrusNotFoundError,
} from "@mysten/walrus";

import { walrusBlobIdFromU256 } from "../codecs.js";
import { BlobExpiredError, NotFoundError, TransportError } from "../errors.js";
import type {
	BlobObjectId,
	BlobRef,
	QuiltPatchId,
	WalrusBlobId,
} from "../types.js";
import { quiltPatchIdToString } from "./quilt-patch-id.js";

/** Optional knobs threaded through every read. */
export interface WalrusReadOptions {
	readonly signal?: AbortSignal;
}

/** Read-only Walrus client, symmetric to `WalrusWriteAdapter`. */
export interface WalrusReadAdapter {
	/**
	 * Read by Walrus content-addressed blob id (the 43-char URL-safe-base64
	 * identifier returned by `uploadBlob` / `uploadQuilt`). Cheapest path
	 * when you already have the content id from an upload result.
	 */
	readBlob(
		blobId: WalrusBlobId,
		options?: WalrusReadOptions,
	): Promise<Uint8Array>;

	/**
	 * Read by Sui object id of the on-chain `Blob` object. Resolves the
	 * object to its `blob_id` first, then reads. Use this when you have
	 * `Revision.blobRef.blobObjectId` from `reader.getEntry(...)` and need
	 * the bytes back (e.g. for decryption).
	 *
	 * A failed read is classified against the object's lifecycle: an ended
	 * lease throws `BlobExpiredError`, a never-certified blob `NotFoundError`,
	 * and a live, certified blob the storage nodes did not return
	 * `TransportError`, since retrying (or an aggregator) can still serve it.
	 *
	 * `options.signal` cancels the underlying blob fetch but not the
	 * preceding `getBlobObject` resolution; @mysten/walrus does not accept
	 * a signal on the resolution call. Cancelling between resolve and read
	 * lets the bytes-fetch abort.
	 */
	readBlobByObjectId(
		blobObjectId: BlobObjectId,
		options?: WalrusReadOptions,
	): Promise<Uint8Array>;

	/**
	 * Read a single quilt patch by its 37-byte branded id. Use this when
	 * `BlobRef.kind === "quilt"`.
	 *
	 * `options.signal` is accepted for API symmetry with the other reads
	 * but is not forwarded: @mysten/walrus's `getFiles` and the resulting
	 * `WalrusFile.bytes()` do not accept signals at this version. Long-
	 * running quilt-patch fetches cannot currently be cancelled.
	 */
	readQuiltPatch(
		patchId: QuiltPatchId,
		options?: WalrusReadOptions,
	): Promise<Uint8Array>;

	/**
	 * Convenience: dispatch on the `BlobRef` discriminant and read the
	 * corresponding payload. Lets consumers do
	 * `await reader.readBlobRef(revision.blobRef)` without switching on
	 * `kind` themselves.
	 */
	readBlobRef(
		blobRef: BlobRef,
		options?: WalrusReadOptions,
	): Promise<Uint8Array>;
}

/** The fields of an on-chain Walrus `Blob` object the read adapter uses. */
interface WalrusBlobObject {
	readonly id: string;
	/** Move `u256` as a decimal string, not the base64 id `readBlob` takes. */
	readonly blob_id: string;
	/** Epoch the blob was certified in; `null` while it is only registered. */
	readonly certified_epoch: number | null;
	readonly storage: {
		/** Exclusive end of the lease: the first epoch the blob is not stored in. */
		readonly end_epoch: number;
	};
}

/** Narrow structural slice of `WalrusClient` actually used by the read adapter. */
interface WalrusReadClient {
	readBlob(args: { blobId: string; signal?: AbortSignal }): Promise<Uint8Array>;
	getBlobObject(blobObjectId: string): Promise<WalrusBlobObject>;
	getFiles(args: { ids: string[] }): Promise<WalrusFile[]>;
	systemState(): Promise<{ readonly committee: { readonly epoch: number } }>;
}

interface DefaultWalrusReadAdapterOptions {
	readonly client: WalrusReadClient;
}

/** Convenience options for `DefaultWalrusReadAdapter.fromConfig`. */
export type WalrusReadAdapterConfig = WalrusClientConfig;

/** `WalrusReadAdapter` backed by `@mysten/walrus`'s `WalrusClient`. */
export class DefaultWalrusReadAdapter implements WalrusReadAdapter {
	private readonly client: WalrusReadClient;

	constructor(options: DefaultWalrusReadAdapterOptions) {
		this.client = options.client;
	}

	/**
	 * Build an adapter from a `WalrusClientConfig`. Equivalent to
	 * constructing the `WalrusClient` yourself and passing it in.
	 */
	static fromConfig(config: WalrusReadAdapterConfig): DefaultWalrusReadAdapter {
		return new DefaultWalrusReadAdapter({
			client: new WalrusClient(config),
		});
	}

	async readBlob(
		blobId: WalrusBlobId,
		options: WalrusReadOptions = {},
	): Promise<Uint8Array> {
		return runWalrusCall(
			() =>
				this.client.readBlob({
					blobId,
					...(options.signal === undefined ? {} : { signal: options.signal }),
				}),
			{ operation: "walrus.readBlob", kind: "blob", id: blobId },
		);
	}

	async readBlobByObjectId(
		blobObjectId: BlobObjectId,
		options: WalrusReadOptions = {},
	): Promise<Uint8Array> {
		const blob = await runWalrusCall(
			() => this.client.getBlobObject(blobObjectId),
			{
				operation: "walrus.getBlobObject",
				kind: "blob object",
				id: blobObjectId,
			},
		);
		const blobId = walrusBlobIdFromU256(blob.blob_id);
		// Fetch the epoch before the read rather than after a failure: the read
		// loads the same system state and the client caches it, so this costs
		// no extra round trip, whereas a failed read clears that cache.
		const currentEpoch = await this.currentEpoch();
		try {
			return await this.readBlob(blobId, options);
		} catch (error) {
			if (options.signal?.aborted) {
				throw error;
			}
			throw classifyFailedRead(error, {
				blob,
				blobId,
				blobObjectId,
				currentEpoch,
			});
		}
	}

	async readQuiltPatch(
		patchId: QuiltPatchId,
		_options: WalrusReadOptions = {},
	): Promise<Uint8Array> {
		const id = quiltPatchIdToString(patchId);
		const target: ReadTarget = {
			operation: "walrus.getFiles",
			kind: "quilt patch",
			id,
		};
		const files = await runWalrusCall(
			() => this.client.getFiles({ ids: [id] }),
			target,
		);
		const file = files[0];
		if (!file) {
			throw new TransportError(
				`Walrus getFiles returned no entry for quilt patch ${id}`,
				{ operation: "walrus.getFiles" },
			);
		}
		return runWalrusCall(() => file.bytes(), {
			...target,
			operation: "walrus.readQuiltPatch",
		});
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

	private async currentEpoch(): Promise<number> {
		try {
			return (await this.client.systemState()).committee.epoch;
		} catch (cause) {
			throw new TransportError(
				`Walrus system state could not be read: ${causeMessage(cause)}`,
				{ cause, operation: "walrus.systemState" },
			);
		}
	}
}

/** What a Walrus call reads, for the error it raises when it fails. */
interface ReadTarget {
	readonly operation: string;
	readonly kind: "blob" | "blob object" | "quilt patch";
	/** The bare id: it becomes `NotFoundError.identifier`. */
	readonly id: string;
}

/**
 * Run a Walrus read, mapping its failure onto the SDK taxonomy. Only an
 * answer that the content is not stored (a storage node's 404, or a quorum
 * reporting the blob uncertified) is a `NotFoundError`. Getting no answer,
 * such as `NoBlobMetadataReceivedError` when no node returns metadata, is a
 * `TransportError`: the blob may be perfectly healthy.
 */
async function runWalrusCall<T>(
	call: () => Promise<T>,
	target: ReadTarget,
): Promise<T> {
	try {
		return await call();
	} catch (cause) {
		if (cause instanceof TransportError || cause instanceof NotFoundError) {
			throw cause;
		}
		if (
			cause instanceof WalrusNotFoundError ||
			cause instanceof BlobNotCertifiedError
		) {
			throw new NotFoundError("blob", target.id, { cause });
		}
		throw new TransportError(
			`Walrus read of ${target.kind} ${target.id} failed: ${causeMessage(cause)}`,
			{ cause, operation: target.operation },
		);
	}
}

interface BlobLifecycle {
	readonly blob: WalrusBlobObject;
	readonly blobId: WalrusBlobId;
	readonly blobObjectId: BlobObjectId;
	readonly currentEpoch: number;
}

/**
 * Re-classify a failed blob read against the blob's on-chain lifecycle.
 * Storage nodes that do not answer look the same for a live blob and an
 * expired one, and nodes that report a blob missing do not say why; the
 * `Blob` object does.
 */
function classifyFailedRead(error: unknown, lifecycle: BlobLifecycle): unknown {
	if (!(error instanceof NotFoundError || error instanceof TransportError)) {
		return error;
	}
	const { blob, blobId, blobObjectId, currentEpoch } = lifecycle;
	const endEpoch = blob.storage.end_epoch;
	if (endEpoch <= currentEpoch) {
		return new BlobExpiredError(
			blobId,
			{ blobObjectId, endEpoch, currentEpoch },
			{ cause: error },
		);
	}
	if (blob.certified_epoch === null) {
		return new NotFoundError("blob", blobId, { cause: error });
	}
	return new TransportError(
		`Walrus storage nodes did not return blob ${blobId}, which is certified and stored until epoch ${endEpoch}: ${causeMessage(error.cause ?? error)}`,
		{ cause: error, operation: "walrus.readBlob" },
	);
}

function causeMessage(cause: unknown): string {
	if (cause instanceof Error && cause.message.length > 0) {
		return cause.message;
	}
	return "no error detail";
}
