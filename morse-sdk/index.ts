import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

export type TransactionExecutor = Pick<
	SuiGrpcClient,
	"signAndExecuteTransaction" | "waitForTransaction"
>;
export type ObjectFetcher = Pick<
	SuiGrpcClient,
	"getObject" | "listOwnedObjects"
>;
export type PublicationDeleter = TransactionExecutor &
	Pick<ObjectFetcher, "getObject">;
export type CollectionManager = TransactionExecutor &
	Pick<ObjectFetcher, "listOwnedObjects">;
export type EntryFetcher = Pick<
	SuiGrpcClient,
	"getObject" | "getObjects" | "listDynamicFields"
>;

export interface EntryReceipt {
	digest: string;
	gasUsedMist: bigint; // computationCost + storageCost - storageRebate
}

export function formatMist(mist: bigint, tokenName = "SUI"): string {
	const whole = mist / 1_000_000_000n;
	const frac = mist % 1_000_000_000n;
	const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
	return fracStr.length > 0
		? `${whole}.${fracStr} ${tokenName}`
		: `${whole} ${tokenName}`;
}

export async function createPublication(
	client: TransactionExecutor,
	signer: Ed25519Keypair,
	publicationAddress: string,
	name: string,
): Promise<string> {
	const tx = new Transaction();

	tx.moveCall({
		target: `${publicationAddress}::publication::new_publication`,
		arguments: [tx.pure.string(name)],
	});

	const result = await client.signAndExecuteTransaction({
		signer,
		transaction: tx,
	});

	if (result.$kind === "FailedTransaction") {
		throw new Error(
			`Transaction failed: ${result.FailedTransaction.status.error?.message}`,
		);
	}

	const waitResult = await client.waitForTransaction({ result });
	return waitResult.Transaction?.digest ?? "";
}

export async function listPublications(
	client: ObjectFetcher,
	signer: Ed25519Keypair,
	originalPublicationAddress: string,
): Promise<Array<{ id: string; name: string; capId: string }>> {
	const caps = await client.listOwnedObjects({
		owner: signer.getPublicKey().toSuiAddress(),
		type: `${originalPublicationAddress}::publication::OwnerCap`,
		include: { json: true },
	});

	const publications = await Promise.all(
		caps.objects.map((cap) =>
			client.getObject({
				objectId: (cap.json as { publication_id: string }).publication_id,
				include: { json: true },
			}),
		),
	);

	return publications.map((pub, i) => ({
		id: pub.object.objectId,
		name:
			(pub.object.json as { name: string } | undefined)?.name ?? "(unknown)",
		capId: caps.objects[i]!.objectId,
	}));
}

export async function getPublication(
	client: ObjectFetcher,
	id: string,
): Promise<object> {
	const publication = await client.getObject({
		objectId: id,
		include: { json: true },
	});
	return publication.object.json as object;
}

export async function deletePublication(
	client: PublicationDeleter,
	signer: Ed25519Keypair,
	publicationAddress: string,
	id: string,
	capId: string,
): Promise<{ digest: string; name: string }> {
	const publication = await client.getObject({
		objectId: id,
		include: { json: true },
	});
	const name =
		(publication.object.json as { name: string } | undefined)?.name ?? id;

	const tx = new Transaction();

	tx.moveCall({
		target: `${publicationAddress}::publication::delete_publication`,
		arguments: [tx.object(id), tx.object(capId)],
	});

	const result = await client.signAndExecuteTransaction({
		signer,
		transaction: tx,
	});

	if (result.$kind === "FailedTransaction") {
		throw new Error(
			`Transaction failed: ${result.FailedTransaction.status.error?.message}`,
		);
	}

	const waitResult = await client.waitForTransaction({ result });
	return { digest: waitResult.Transaction?.digest ?? "", name };
}

async function resolvePublisherCap(
	client: Pick<ObjectFetcher, "listOwnedObjects">,
	signer: Ed25519Keypair,
	publicationAddress: string,
	publicationId: string,
): Promise<string> {
	const caps = await client.listOwnedObjects({
		owner: signer.getPublicKey().toSuiAddress(),
		type: `${publicationAddress}::publication::PublisherCap`,
		include: { json: true },
	});
	const cap = caps.objects.find(
		(c) =>
			(c.json as { publication_id: string }).publication_id === publicationId,
	);
	if (!cap)
		throw new Error(`No PublisherCap found for publication ${publicationId}`);
	return cap.objectId;
}

export async function addCollection(
	client: CollectionManager,
	signer: Ed25519Keypair,
	publicationAddress: string,
	publicationId: string,
	name: string,
): Promise<string> {
	const publisherCapId = await resolvePublisherCap(
		client,
		signer,
		publicationAddress,
		publicationId,
	);

	const tx = new Transaction();
	const collection = tx.moveCall({
		target: `${publicationAddress}::collection::new_collection`,
		arguments: [tx.pure.id(publicationId), tx.pure.string(name)],
	});
	tx.moveCall({
		target: `${publicationAddress}::publication::add_collection`,
		arguments: [
			tx.object(publicationId),
			tx.object(publisherCapId),
			collection,
		],
	});

	const result = await client.signAndExecuteTransaction({
		signer,
		transaction: tx,
	});
	if (result.$kind === "FailedTransaction") {
		throw new Error(
			`Transaction failed: ${result.FailedTransaction.status.error?.message}`,
		);
	}
	const waitResult = await client.waitForTransaction({ result });
	return waitResult.Transaction?.digest ?? "";
}

export async function deleteCollection(
	client: CollectionManager,
	signer: Ed25519Keypair,
	publicationAddress: string,
	publicationId: string,
	name: string,
): Promise<string> {
	const publisherCapId = await resolvePublisherCap(
		client,
		signer,
		publicationAddress,
		publicationId,
	);

	const tx = new Transaction();
	tx.moveCall({
		target: `${publicationAddress}::publication::delete_collection`,
		arguments: [
			tx.object(publicationId),
			tx.object(publisherCapId),
			tx.pure.string(name),
		],
	});

	const result = await client.signAndExecuteTransaction({
		signer,
		transaction: tx,
	});
	if (result.$kind === "FailedTransaction") {
		throw new Error(
			`Transaction failed: ${result.FailedTransaction.status.error?.message}`,
		);
	}
	const waitResult = await client.waitForTransaction({ result });
	return waitResult.Transaction?.digest ?? "";
}

export async function addEntry(
	client: CollectionManager,
	signer: Ed25519Keypair,
	publicationAddress: string,
	publicationId: string,
	collectionName: string,
	name: string,
	entryType: string,
	blobId: string,
): Promise<EntryReceipt> {
	const publisherCapId = await resolvePublisherCap(
		client,
		signer,
		publicationAddress,
		publicationId,
	);

	const tx = new Transaction();
	const entry = tx.moveCall({
		target: `${publicationAddress}::entry::new_entry`,
		arguments: [
			tx.pure.string(name),
			tx.pure.string(entryType),
			tx.pure.id(blobId),
		],
	});
	tx.moveCall({
		target: `${publicationAddress}::publication::add_entry_to_collection`,
		arguments: [
			tx.object(publicationId),
			tx.object(publisherCapId),
			tx.pure.string(collectionName),
			entry,
		],
	});

	const result = await client.signAndExecuteTransaction({
		signer,
		transaction: tx,
	});

	if (result.$kind === "FailedTransaction") {
		throw new Error(
			`Transaction failed: ${result.FailedTransaction.status.error?.message}`,
		);
	}
	const waitResult = await client.waitForTransaction({
		result,
		include: { effects: true },
	});
	const confirmed = waitResult.Transaction;
	if (!confirmed?.effects) throw new Error("Transaction effects missing");
	const { computationCost, storageCost, storageRebate } =
		confirmed.effects.gasUsed;
	const gasUsedMist =
		BigInt(computationCost) + BigInt(storageCost) - BigInt(storageRebate);
	return { digest: confirmed.digest, gasUsedMist };
}

export async function deleteEntry(
	client: CollectionManager,
	signer: Ed25519Keypair,
	publicationAddress: string,
	publicationId: string,
	collectionName: string,
	index: number,
): Promise<string> {
	const publisherCapId = await resolvePublisherCap(
		client,
		signer,
		publicationAddress,
		publicationId,
	);

	const tx = new Transaction();
	tx.moveCall({
		target: `${publicationAddress}::publication::delete_entry_from_collection`,
		arguments: [
			tx.object(publicationId),
			tx.object(publisherCapId),
			tx.pure.string(collectionName),
			tx.pure.u64(index),
		],
	});

	const result = await client.signAndExecuteTransaction({
		signer,
		transaction: tx,
	});
	if (result.$kind === "FailedTransaction") {
		throw new Error(
			`Transaction failed: ${result.FailedTransaction.status.error?.message}`,
		);
	}
	const waitResult = await client.waitForTransaction({ result });
	return waitResult.Transaction?.digest ?? "";
}

export async function listCollections(
	client: Pick<ObjectFetcher, "getObject">,
	publicationId: string,
): Promise<string[]> {
	const publication = await client.getObject({
		objectId: publicationId,
		include: { json: true },
	});
	const collections = (
		publication.object.json as
			| { collections?: { contents?: { key: string }[] } }
			| undefined
	)?.collections;
	return collections?.contents?.map((e) => e.key) ?? [];
}

export async function addSingleton(
	client: CollectionManager,
	signer: Ed25519Keypair,
	publicationAddress: string,
	publicationId: string,
	name: string,
	entryType: string,
	blobId: string,
): Promise<string> {
	const publisherCapId = await resolvePublisherCap(
		client,
		signer,
		publicationAddress,
		publicationId,
	);

	const tx = new Transaction();
	const entry = tx.moveCall({
		target: `${publicationAddress}::entry::new_entry`,
		arguments: [
			tx.pure.string(name),
			tx.pure.string(entryType),
			tx.pure.id(blobId),
		],
	});
	tx.moveCall({
		target: `${publicationAddress}::publication::add_singleton`,
		arguments: [tx.object(publicationId), tx.object(publisherCapId), entry],
	});

	const result = await client.signAndExecuteTransaction({
		signer,
		transaction: tx,
	});
	if (result.$kind === "FailedTransaction") {
		throw new Error(
			`Transaction failed: ${result.FailedTransaction.status.error?.message}`,
		);
	}
	const waitResult = await client.waitForTransaction({ result });
	return waitResult.Transaction?.digest ?? "";
}

export async function deleteSingleton(
	client: CollectionManager,
	signer: Ed25519Keypair,
	publicationAddress: string,
	publicationId: string,
	name: string,
): Promise<string> {
	const publisherCapId = await resolvePublisherCap(
		client,
		signer,
		publicationAddress,
		publicationId,
	);

	const tx = new Transaction();
	tx.moveCall({
		target: `${publicationAddress}::publication::delete_singleton`,
		arguments: [
			tx.object(publicationId),
			tx.object(publisherCapId),
			tx.pure.string(name),
		],
	});

	const result = await client.signAndExecuteTransaction({
		signer,
		transaction: tx,
	});
	if (result.$kind === "FailedTransaction") {
		throw new Error(
			`Transaction failed: ${result.FailedTransaction.status.error?.message}`,
		);
	}
	const waitResult = await client.waitForTransaction({ result });
	return waitResult.Transaction?.digest ?? "";
}

export async function listSingletons(
	client: Pick<ObjectFetcher, "getObject">,
	publicationId: string,
): Promise<Array<{ name: string; entryType: string; blob: string }>> {
	const publication = await client.getObject({
		objectId: publicationId,
		include: { json: true },
	});
	type SingletonEntry = {
		key: string;
		value: { name: string; entry_type: string; blob: string };
	};
	const contents = (
		publication.object.json as
			| { singletons?: { contents?: SingletonEntry[] } }
			| undefined
	)?.singletons?.contents;
	return (contents ?? []).map((e) => ({
		name: e.key,
		entryType: e.value.entry_type,
		blob: e.value.blob,
	}));
}

export async function addAsset(
	client: CollectionManager,
	signer: Ed25519Keypair,
	publicationAddress: string,
	publicationId: string,
	name: string,
	entryType: string,
	blobId: string,
): Promise<string> {
	const publisherCapId = await resolvePublisherCap(
		client,
		signer,
		publicationAddress,
		publicationId,
	);

	const tx = new Transaction();
	const asset = tx.moveCall({
		target: `${publicationAddress}::entry::new_entry`,
		arguments: [
			tx.pure.string(name),
			tx.pure.string(entryType),
			tx.pure.id(blobId),
		],
	});
	tx.moveCall({
		target: `${publicationAddress}::publication::add_asset`,
		arguments: [tx.object(publicationId), tx.object(publisherCapId), asset],
	});

	const result = await client.signAndExecuteTransaction({
		signer,
		transaction: tx,
	});
	if (result.$kind === "FailedTransaction") {
		throw new Error(
			`Transaction failed: ${result.FailedTransaction.status.error?.message}`,
		);
	}
	const waitResult = await client.waitForTransaction({ result });
	return waitResult.Transaction?.digest ?? "";
}

export async function deleteAsset(
	client: CollectionManager,
	signer: Ed25519Keypair,
	publicationAddress: string,
	publicationId: string,
	name: string,
): Promise<string> {
	const publisherCapId = await resolvePublisherCap(
		client,
		signer,
		publicationAddress,
		publicationId,
	);

	const tx = new Transaction();
	tx.moveCall({
		target: `${publicationAddress}::publication::delete_asset`,
		arguments: [
			tx.object(publicationId),
			tx.object(publisherCapId),
			tx.pure.string(name),
		],
	});

	const result = await client.signAndExecuteTransaction({
		signer,
		transaction: tx,
	});
	if (result.$kind === "FailedTransaction") {
		throw new Error(
			`Transaction failed: ${result.FailedTransaction.status.error?.message}`,
		);
	}
	const waitResult = await client.waitForTransaction({ result });
	return waitResult.Transaction?.digest ?? "";
}

export async function listAssets(
	client: EntryFetcher,
	publicationId: string,
): Promise<Array<{ name: string; entryType: string; blob: string }>> {
	const publication = await client.getObject({
		objectId: publicationId,
		include: { json: true },
	});
	const tableId = (
		publication.object.json as { assets?: { id: string } } | undefined
	)?.assets?.id;
	if (!tableId) return [];

	const { dynamicFields } = await client.listDynamicFields({
		parentId: tableId,
	});
	if (dynamicFields.length === 0) return [];

	const objects = await client.getObjects({
		objectIds: dynamicFields.map((f) => f.fieldId),
		include: { json: true },
	});

	return objects.objects
		.filter((o) => !("$kind" in o))
		.map((o) => {
			const field = (
				o as {
					json?: {
						name: string;
						value?: { name: string; entry_type: string; blob: string };
					};
				}
			).json;
			return {
				name: field?.name ?? "",
				entryType: field?.value?.entry_type ?? "",
				blob: field?.value?.blob ?? "",
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listEntries(
	client: EntryFetcher,
	publicationId: string,
	collectionName: string,
): Promise<
	Array<{ index: number; name: string; entryType: string; blob: string }>
> {
	const publication = await client.getObject({
		objectId: publicationId,
		include: { json: true },
	});
	type CollectionJson = { id: string; entries: { id: string } };
	const contents = (
		publication.object.json as
			| {
					collections?: { contents?: { key: string; value: CollectionJson }[] };
			  }
			| undefined
	)?.collections?.contents;
	const col = contents?.find((e) => e.key === collectionName);
	if (!col) throw new Error(`Collection "${collectionName}" not found`);

	const tableId = col.value.entries.id;
	const { dynamicFields } = await client.listDynamicFields({
		parentId: tableId,
	});
	if (dynamicFields.length === 0) return [];

	const objects = await client.getObjects({
		objectIds: dynamicFields.map((f) => f.fieldId),
		include: { json: true },
	});

	return objects.objects
		.filter((o) => !("$kind" in o))
		.map((o) => {
			const field = (
				o as {
					json?: {
						name: number | string;
						value?: { name: string; entry_type: string; blob: string };
					};
				}
			).json;
			return {
				index: Number(field?.name ?? 0),
				name: field?.value?.name ?? "",
				entryType: field?.value?.entry_type ?? "",
				blob: field?.value?.blob ?? "",
			};
		})
		.sort((a, b) => a.index - b.index);
}
