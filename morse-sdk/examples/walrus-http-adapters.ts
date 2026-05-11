/**
 * Walrus HTTP adapters: swap the default direct-protocol read/write pair
 * for the publisher (writes) and aggregator (reads) HTTP services.
 *
 * Why: browser dapps that hit CORS gaps on testnet direct reads, or dapps
 * that want a "publisher pays storage" onboarding path with 1 wallet popup
 * instead of 2-3. Trade trustless reads/writes for operator trust; use
 * `verifyBlobIntegrity` on the read adapter for a trust-but-verify path.
 *
 * The HTTP adapters implement the same `WalrusReadAdapter` /
 * `WalrusWriteAdapter` interfaces as the default pair, so the rest of the
 * SDK is unchanged. They're NOT compatible with `addEntryFromBytes` /
 * `addEncryptedEntryFromBytes` — those require `WalrusFlowCapable` for the
 * 2-popup combined PTB; the publisher-paid path is naturally 1-popup
 * through standard `uploadBlob` + `addEntry`.
 *
 * Function names in this file are illustrative.
 */

import type {
	BlobObjectId,
	PublicationId,
	PublisherCapId,
	WalrusBlobId,
} from "morse-sdk";
import {
	addEntry,
	HttpAggregatorReadAdapter,
	HttpPublisherWriteAdapter,
} from "morse-sdk";
import type { ExampleContext } from "./setup.js";

/**
 * Read a blob via the canonical Mysten testnet aggregator. Single
 * CORS-friendly endpoint instead of the ~30-node direct fanout.
 */
export async function readBlobViaAggregator(
	ctx: ExampleContext,
	blobId: WalrusBlobId,
): Promise<Uint8Array> {
	const reader = HttpAggregatorReadAdapter.fromMorseConfig(
		ctx.config,
		ctx.client,
	);
	return reader.readBlob(blobId);
}

/**
 * Upload via a publisher HTTP service. The publisher pays the WAL storage
 * deposit; the consumer only signs the downstream `add_entry_to_collection`
 * transaction (1 wallet popup total). The publisher sends the resulting
 * Blob object to `ctx.adapter.address` so the consumer's `addEntry` can
 * reference it.
 *
 * Pick a publisher you trust. Production dapps typically run their own or
 * pay a hosted service; the URL below is one example public testnet
 * publisher.
 */
export async function uploadAndAddEntryViaPublisher(
	ctx: ExampleContext,
	args: {
		publisherUrl: string;
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		bytes: Uint8Array;
	},
): Promise<{ entryId: number; blobObjectId: BlobObjectId }> {
	const walrus = HttpPublisherWriteAdapter.fromConfig({
		publisherUrl: args.publisherUrl,
		ownerAddress: ctx.adapter.address,
	});

	// Upload via the publisher. Server-side register + certify; 0 user popups.
	const blob = await walrus.uploadBlob(args.bytes, {
		epochs: 3,
		deletable: true,
	});

	// Reference the freshly-uploaded blob in an entry. 1 user popup.
	const entry = await addEntry(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		collectionName: "blog",
		name: "first-post",
		blobObjectId: blob.blobObjectId,
		contentType: "text/plain",
	});

	return { entryId: entry.entryId, blobObjectId: blob.blobObjectId };
}
