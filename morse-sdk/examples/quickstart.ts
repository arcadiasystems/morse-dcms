/**
 * The happy path: spin up a publication, add a blob-mode collection, upload a
 * payload to Walrus, attach it as the first revision of an entry, read back.
 *
 * Production code typically composes these steps separately. This file is the
 * "what does morse-sdk look like end-to-end" overview; for individual flows,
 * see the per-concern files in this directory.
 *
 * Function and value names in this file are illustrative. Substitute your own.
 */

import {
	addEntry,
	ContractAbortError,
	createCollection,
	createPublication,
	DefaultWalrusWriteAdapter,
	StorageMode,
	TransportError,
	ValidationError,
} from "morse-sdk";
import { buildContext } from "./setup.js";

export async function quickstart(privateKey: string): Promise<void> {
	const ctx = buildContext(privateKey);

	// 1. Create a publication. Returns the publication's ID along with an
	//    OwnerCap (governance) and the first PublisherCap (write authority),
	//    both transferred to the adapter's address atomically.
	const created = await createPublication(ctx.adapter, ctx.config, {
		name: "My Publication",
		slug: "my-publication",
	});

	// 2. Create a blob-mode collection inside it. `storageMode` is fixed at
	//    creation; switching to `Quilt` for the same name later requires
	//    deleting and recreating.
	await createCollection(ctx.adapter, ctx.config, {
		publicationId: created.publicationId,
		publisherCapId: created.publisherCapId,
		name: "blog",
		storageMode: StorageMode.Blob,
	});

	// 3. Upload a payload to Walrus. The Move layer rejects non-deletable
	//    blobs; always pass `deletable: true`.
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);
	const blob = await walrus.uploadBlob(
		new TextEncoder().encode("hello world"),
		{ epochs: 3, deletable: true },
	);

	// 4. Attach the blob as the first revision of a new entry. Entry IDs are
	//    monotonic u64s assigned by the contract; the SDK retrieves them via
	//    a pre-flight simulation of the same PTB.
	const entry = await addEntry(ctx.adapter, ctx.config, {
		publicationId: created.publicationId,
		publisherCapId: created.publisherCapId,
		collectionName: "blog",
		name: "first-post",
		blobObjectId: blob.blobObjectId,
		contentType: "text/plain",
	});

	// 5. Read it back. The returned `Entry` carries the synthetic id, the
	//    name, and the full revision vector. Each revision has a `BlobRef`
	//    discriminated union (switch on `kind` for blob vs quilt) plus
	//    `contentType`, `encrypted`, `accessPolicy`, `sealId`, `author`.
	const fetched = await ctx.reader.getEntry(
		created.publicationId,
		"blog",
		entry.entryId,
	);
	const firstRevision = fetched.revisions[0];
	console.log({
		entryId: fetched.id,
		name: fetched.name,
		publicHead: fetched.publicHead,
		blobRef: firstRevision?.blobRef,
		contentType: firstRevision?.contentType,
	});
}

/**
 * The same flow with the three errors a new consumer is most likely to hit.
 * `ContractAbortError` covers the named Move aborts (e.g. duplicate slug);
 * `ValidationError` is client-side input rejection; `TransportError` is RPC
 * or network failure. See the README's error taxonomy for the full set.
 */
export async function quickstartWithErrorHandling(
	privateKey: string,
): Promise<void> {
	try {
		await quickstart(privateKey);
	} catch (err) {
		if (err instanceof ContractAbortError) {
			console.error(`move abort: ${err.module}::${err.reason}`);
		} else if (err instanceof ValidationError) {
			console.error(`bad input on ${err.field}: ${err.message}`);
		} else if (err instanceof TransportError) {
			console.error(`transport: ${err.message}`);
		} else {
			throw err;
		}
	}
}
