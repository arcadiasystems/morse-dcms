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
	addEntryFromBytes,
	ContractAbortError,
	createCollection,
	createPublication,
	DefaultWalrusWriteAdapter,
	StorageMode,
	TransportError,
	UncertifiedBlobError,
	ValidationError,
} from "@arcadiasystems/morse-sdk";
import { buildContext } from "./setup.js";

export async function quickstart(privateKey: string): Promise<void> {
	const ctx = buildContext(privateKey);

	// 1. Create a publication. Returns the publication's ID along with an
	//    OwnerCap (governance) and the first PublisherCap (write authority),
	//    both transferred to the adapter's address atomically.
	const created = await createPublication(ctx.adapter, ctx.config, {
		name: "My Publication",
		slug: `my-pub-${Date.now()}`, // slugs are globally unique on-chain
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

	// 3. Build the Walrus write adapter once. Browser flows substitute a
	//    wallet-standard signer for `ctx.keypair`. The Move layer rejects
	//    non-deletable blobs; always pass `deletable: true`.
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);

	// 4. Upload bytes and add them as the first revision of a new entry in 2
	//    wallet popups (register_blob, then certify_blob + add_entry combined
	//    into a single PTB). Entry IDs are monotonic u64s assigned by the
	//    contract; the SDK retrieves them via a pre-flight simulation. For
	//    pre-uploaded blobs (deduplication, decoupled timing, server-side
	//    pre-upload), use the lower-level `uploadBlob` + `addEntry` pair —
	//    see the README's "Choosing the right entry path".
	const entry = await addEntryFromBytes(ctx.adapter, ctx.config, {
		walrus,
		publicationId: created.publicationId,
		publisherCapId: created.publisherCapId,
		collectionName: "blog",
		name: "first-post",
		bytes: new TextEncoder().encode("hello world"),
		contentType: "text/plain",
		upload: { epochs: 3, deletable: true },
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
 * The same flow with the four errors a new consumer is most likely to hit.
 * `ContractAbortError` covers the named Move aborts (e.g. duplicate slug);
 * `ValidationError` is client-side input rejection; `TransportError` is RPC
 * or network failure; `UncertifiedBlobError` signals the second popup of
 * `addEntryFromBytes` failed after the blob was uploaded (the bytes are on
 * Walrus but unattached). See the README's error taxonomy for the full set.
 */
export async function quickstartWithErrorHandling(
	privateKey: string,
): Promise<void> {
	try {
		await quickstart(privateKey);
	} catch (err) {
		if (err instanceof UncertifiedBlobError) {
			console.error(
				`uncertified blob ${err.blobObjectId} (id ${err.blobId}); upload succeeded but the entry was not created`,
			);
		} else if (err instanceof ContractAbortError) {
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
