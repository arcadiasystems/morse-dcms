/**
 * `WalrusWriteAdapter` implementation backed by `@mysten/walrus`. Bind a
 * `WalrusClient` to a Sui `Signer` once, then call `uploadBlob` /
 * `uploadQuilt` per write. Read paths live elsewhere.
 */

import type { Signer } from "@mysten/sui/cryptography";
import type { Transaction } from "@mysten/sui/transactions";
import {
	UserAbortError,
	WalrusClient,
	type WalrusClientConfig,
	type WriteBlobFlow,
	type WriteBlobStepRegistered,
} from "@mysten/walrus";

import { toBlobObjectId, toWalrusBlobId } from "../codecs.js";
import { TransportError, ValidationError } from "../errors.js";
import type { BlobObjectId, QuiltPatchId, WalrusBlobId } from "../types.js";
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
	writeBlobFlow(options: { blob: Uint8Array }): WriteBlobFlow;
}

/**
 * Result of `DefaultWalrusWriteAdapter.startBlobUpload`. Caller has a
 * registered, uploaded-but-uncertified blob plus the certify `Transaction`;
 * append further move calls to `certifyTransaction` (e.g.
 * `add_entry_to_collection`) and submit once to land everything in a single
 * wallet popup.
 */
export interface StartBlobUploadResult {
	readonly blobObjectId: BlobObjectId;
	readonly blobId: WalrusBlobId;
	/**
	 * `Transaction` already containing the `walrus::blob::certify_blob` move
	 * call. Append your downstream calls (e.g. `buildAddEntry(tx, ...)`) and
	 * submit the same `Transaction`.
	 */
	readonly certifyTransaction: Transaction;
}

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

	/**
	 * Upload a blob to Walrus end-to-end (register + upload + certify) in 2
	 * wallet popups, returning the certified blob's content id and Sui object
	 * id. For the common "upload then add as a new entry" flow, prefer
	 * `addEntryFromBytes`, which composes upload with `add_entry` into the
	 * same 2 popups. Use this when reusing a blob across multiple entries,
	 * pre-uploading on a server, or otherwise decoupling upload from entry
	 * creation.
	 */
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

	/**
	 * Register and upload a blob without certifying it on-chain. Returns the
	 * blob's Sui object id, content id, and the certify `Transaction`. The
	 * caller is expected to append further move calls (e.g.
	 * `add_entry_to_collection`) to `certifyTransaction` and submit once,
	 * combining certify + downstream ops into a single wallet popup.
	 *
	 * The first wallet popup (register_blob) happens inside this call. The
	 * second popup is whoever submits `certifyTransaction`.
	 *
	 * Failure modes:
	 *   - register fails -> throws `TransportError` with the underlying cause; nothing was uploaded
	 *   - off-chain upload fails after register -> throws `TransportError`; the blob is registered but unuploaded (will eventually expire)
	 *   - caller decides not to submit `certifyTransaction` -> blob remains registered+uploaded but uncertified; storage releases on registration expiry
	 */
	async startBlobUpload(
		data: Uint8Array,
		options: UploadBlobOptions,
	): Promise<StartBlobUploadResult> {
		return runWalrusCall(async () => {
			const flow = this.client.writeBlobFlow({ blob: data });
			await flow.encode();
			const registered: WriteBlobStepRegistered = await flow.executeRegister({
				epochs: options.epochs,
				deletable: options.deletable,
				signer: this.signer,
				owner: options.owner ?? this.signer.toSuiAddress(),
			});
			await flow.upload(
				options.signal === undefined ? {} : { signal: options.signal },
			);
			const certifyTransaction = flow.certify();
			return {
				blobObjectId: toBlobObjectId(registered.blobObjectId),
				blobId: toWalrusBlobId(registered.blobId),
				certifyTransaction,
			};
		});
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
