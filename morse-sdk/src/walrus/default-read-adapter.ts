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
	NoBlobMetadataReceivedError,
	WalrusClient,
	type WalrusClientConfig,
	type WalrusFile,
	NotFoundError as WalrusNotFoundError,
} from "@mysten/walrus";

import { NotFoundError, TransportError } from "../errors.js";
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

/** Narrow structural slice of `WalrusClient` actually used by the read adapter. */
interface WalrusReadClient {
	readBlob(args: { blobId: string; signal?: AbortSignal }): Promise<Uint8Array>;
	getBlobObject(blobObjectId: string): Promise<{
		id: string;
		blob_id: string;
	}>;
	getFiles(args: { ids: string[] }): Promise<WalrusFile[]>;
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
		return runWalrusCall(() =>
			this.client.readBlob({
				blobId,
				...(options.signal === undefined ? {} : { signal: options.signal }),
			}),
		);
	}

	async readBlobByObjectId(
		blobObjectId: BlobObjectId,
		options: WalrusReadOptions = {},
	): Promise<Uint8Array> {
		const blob = await runWalrusCall(() =>
			this.client.getBlobObject(blobObjectId),
		);
		return runWalrusCall(() =>
			this.client.readBlob({
				blobId: blob.blob_id,
				...(options.signal === undefined ? {} : { signal: options.signal }),
			}),
		);
	}

	async readQuiltPatch(
		patchId: QuiltPatchId,
		_options: WalrusReadOptions = {},
	): Promise<Uint8Array> {
		const id = quiltPatchIdToString(patchId);
		const files = await runWalrusCall(() =>
			this.client.getFiles({ ids: [id] }),
		);
		const file = files[0];
		if (!file) {
			throw new TransportError(
				`Walrus getFiles returned no entry for quilt patch ${id}`,
			);
		}
		return runWalrusCall(() => file.bytes());
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
}

async function runWalrusCall<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (cause) {
		if (cause instanceof TransportError || cause instanceof NotFoundError) {
			throw cause;
		}
		if (
			cause instanceof WalrusNotFoundError ||
			cause instanceof NoBlobMetadataReceivedError
		) {
			throw new NotFoundError("blob", `Walrus blob: ${cause.message}`, {
				cause,
			});
		}
		throw new TransportError(walrusErrorMessage(cause), { cause });
	}
}

function walrusErrorMessage(cause: unknown): string {
	if (cause instanceof Error) {
		return `Walrus read failed: ${cause.message}`;
	}
	return "Walrus read failed";
}
