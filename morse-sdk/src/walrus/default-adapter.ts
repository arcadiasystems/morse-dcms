/**
 * `WalrusWriteAdapter` implementation backed by `@mysten/walrus`. Bind a
 * `WalrusClient` to a Sui `Signer` once, then call `uploadBlob` /
 * `uploadQuilt` per write. Read paths live elsewhere.
 */

import type { Signer } from "@mysten/sui/cryptography";
import {
	UserAbortError,
	WalrusClient,
	type WalrusClientConfig,
} from "@mysten/walrus";

import { toBlobObjectId, toWalrusBlobId } from "../codecs.js";
import { TransportError, ValidationError } from "../errors.js";
import type { QuiltPatchId, WalrusBlobId } from "../types.js";
import type {
	QuiltPatchInput,
	UploadBlobOptions,
	UploadBlobResult,
	UploadQuiltOptions,
	UploadQuiltPatch,
	UploadQuiltResult,
	WalrusWriteAdapter,
} from "./adapter.js";
import { quiltPatchIdFromString } from "./quilt-patch-id.js";

/**
 * Narrow structural slice of `WalrusClient` used by the adapter. Internal
 * to the SDK; consumers should pass a real `WalrusClient` (or a structural
 * mock in tests) without importing this name. Mutable arrays match the
 * upstream `@mysten/walrus` types so the constructor cast is single-step.
 */
interface WalrusWriteClient {
	writeBlob(args: {
		blob: Uint8Array;
		deletable: boolean;
		epochs: number;
		signer: Signer;
		owner?: string;
		signal?: AbortSignal;
	}): Promise<{
		blobId: string;
		blobObject: { id: string };
	}>;
	writeQuilt(args: {
		blobs: Array<{
			contents: Uint8Array;
			identifier: string;
			tags?: Record<string, string>;
		}>;
		deletable: boolean;
		epochs: number;
		signer: Signer;
		owner?: string;
		signal?: AbortSignal;
	}): Promise<{
		blobId: string;
		blobObject: { id: string };
		index: {
			patches: Array<{
				patchId: string;
				startIndex: number;
				endIndex: number;
				identifier: string;
			}>;
		};
	}>;
}

export type { WalrusWriteClient };

/** Construction options for `DefaultWalrusWriteAdapter`. */
export interface DefaultWalrusWriteAdapterOptions {
	readonly client: WalrusWriteClient;
	readonly signer: Signer;
}

/** Convenience options for `DefaultWalrusWriteAdapter.fromConfig`. */
export type WalrusAdapterConfig = WalrusClientConfig;

/** Default `WalrusWriteAdapter` wrapping `@mysten/walrus`. */
export class DefaultWalrusWriteAdapter implements WalrusWriteAdapter {
	private readonly client: WalrusWriteClient;
	private readonly signer: Signer;

	constructor(options: DefaultWalrusWriteAdapterOptions) {
		this.client = options.client;
		this.signer = options.signer;
	}

	/**
	 * Build an adapter from a `WalrusClientConfig` and a signer. Equivalent
	 * to constructing the `WalrusClient` yourself and passing it in.
	 */
	static fromConfig(
		config: WalrusAdapterConfig,
		signer: Signer,
	): DefaultWalrusWriteAdapter {
		return new DefaultWalrusWriteAdapter({
			client: new WalrusClient(config),
			signer,
		});
	}

	async uploadBlob(
		data: Uint8Array,
		options: UploadBlobOptions,
	): Promise<UploadBlobResult> {
		const result = await runWalrusCall(() =>
			this.client.writeBlob({
				blob: data,
				deletable: options.deletable,
				epochs: options.epochs,
				signer: this.signer,
				...(options.owner === undefined ? {} : { owner: options.owner }),
				...(options.signal === undefined ? {} : { signal: options.signal }),
			}),
		);

		return {
			blobId: toWalrusBlobId(result.blobId),
			blobObjectId: toBlobObjectId(result.blobObject.id),
		};
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
		const result = await runWalrusCall(() =>
			this.client.writeQuilt({
				blobs: patches.map((p) => ({
					contents: p.contents,
					identifier: p.identifier,
					...(p.tags === undefined ? {} : { tags: { ...p.tags } }),
				})),
				deletable: options.deletable,
				epochs: options.epochs,
				signer: this.signer,
				...(options.owner === undefined ? {} : { owner: options.owner }),
				...(options.signal === undefined ? {} : { signal: options.signal }),
			}),
		);

		const blobId: WalrusBlobId = toWalrusBlobId(result.blobId);
		const decoded: UploadQuiltPatch[] = result.index.patches.map((p) => {
			const patchId: QuiltPatchId = quiltPatchIdFromString(p.patchId);
			return {
				identifier: p.identifier,
				patchId,
				startIndex: p.startIndex,
				endIndex: p.endIndex,
			};
		});

		return {
			blobId,
			blobObjectId: toBlobObjectId(result.blobObject.id),
			patches: decoded,
		};
	}
}

async function runWalrusCall<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (cause) {
		if (cause instanceof ValidationError || cause instanceof TransportError) {
			throw cause;
		}
		if (cause instanceof UserAbortError) {
			throw new TransportError("Walrus call aborted by caller", { cause });
		}
		throw new TransportError(walrusErrorMessage(cause), { cause });
	}
}

function walrusErrorMessage(cause: unknown): string {
	if (cause instanceof Error) {
		return `Walrus call failed: ${cause.message}`;
	}
	return "Walrus call failed";
}
