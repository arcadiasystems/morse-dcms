import { describe, expect, mock, test } from "bun:test";

import {
	toOwnerCapId,
	toPackageId,
	toPublicationId,
	toPublisherCapId,
	toRegistryId,
	toSuiAddress,
	toSuiObjectId,
} from "../codecs.js";
import { NotFoundError, TransportError, ValidationError } from "../errors.js";
import type { PublicationReader } from "../read/reader.js";
import type {
	Publication,
	SuiAddress,
	TxCreatedObject,
	TxReceipt,
} from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import {
	createPublication,
	deletePublication,
	transferOwnership,
} from "./publication.js";

// Synthetic fixture IDs - shape matters, not the value.
const PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const ORIGINAL_PACKAGE_ID = toPackageId(
	"0x0000000000000000000000000000000000000000000000000000000000000222",
);
const REGISTRY_ID = toRegistryId(
	"0x0000000000000000000000000000000000000000000000000000000000000333",
);
const PUBLICATION_ID = toPublicationId(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);
const OWNER_CAP_ID = toOwnerCapId(
	"0x000000000000000000000000000000000000000000000000000000000000bbbb",
);
const PUBLISHER_CAP_ID = toPublisherCapId(
	"0x0000000000000000000000000000000000000000000000000000000000000eee",
);
const SENDER = toSuiAddress(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const RECIPIENT = toSuiAddress(
	"0x0000000000000000000000000000000000000000000000000000000000000222",
);

const CONFIG = {
	packageId: PACKAGE_ID,
	originalPackageId: ORIGINAL_PACKAGE_ID,
	registryId: REGISTRY_ID,
};

function created(
	objectId: string,
	module: string,
	name: string,
): TxCreatedObject {
	// Type strings use the canonical original-id, not the published-at packageId.
	return {
		objectId: toSuiObjectId(objectId),
		objectType: `${ORIGINAL_PACKAGE_ID}::${module}::${name}`,
	};
}

function makeAdapter(
	receipt: TxReceipt,
	address: SuiAddress = SENDER,
): WalletAdapter {
	return {
		address,
		signAndExecuteTransaction: mock(async () => receipt),
		simulateTransaction: mock(async () => []),
	};
}

function makeFailingAdapter(
	error: Error,
	address: SuiAddress = SENDER,
): WalletAdapter {
	return {
		address,
		signAndExecuteTransaction: mock(async () => {
			throw error;
		}),
		simulateTransaction: mock(async () => []),
	};
}

function makeReader(publication: Publication): PublicationReader {
	return {
		getPublication: mock(async () => publication),
		listPublicationsOwnedBy: mock(async () => ({
			results: [],
			nextCursor: null,
		})),
		getPublisherCap: mock(async () => {
			throw new Error("not used in publication tests");
		}),
		listPublisherCapsOwnedBy: mock(async () => ({
			results: [],
			nextCursor: null,
		})),
		getEntry: mock(async () => {
			throw new Error("not used in publication tests");
		}),
		getRevision: mock(async () => {
			throw new Error("not used in publication tests");
		}),
		listEntries: mock(async () => ({ results: [], nextCursor: null })),
		scanEntries: () => ({
			async *[Symbol.asyncIterator]() {
				/* empty */
			},
		}),
	};
}

function emptyPublication(): Publication {
	return {
		id: PUBLICATION_ID,
		name: "P",
		slug: "p",
		collections: [],
		revokedPublisherCapsTableId: toSuiObjectId(
			"0x000000000000000000000000000000000000000000000000000000000000beef",
		),
	};
}

describe("createPublication", () => {
	test("returns a typed result with all three created IDs", async () => {
		const adapter = makeAdapter({
			digest: "tx-1",
			gasUsedMist: 1000n,
			createdObjects: [
				created(PUBLICATION_ID, "publication", "Publication"),
				created(OWNER_CAP_ID, "publication", "OwnerCap"),
				created(PUBLISHER_CAP_ID, "publication", "PublisherCap"),
			],
			deletedObjects: [],
		});
		const result = await createPublication(adapter, CONFIG, {
			name: "My Pub",
			slug: "my-pub",
		});
		expect(result.digest).toBe("tx-1");
		expect(result.gasUsedMist).toBe(1000n);
		expect(result.publicationId as string).toBe(PUBLICATION_ID as string);
		expect(result.ownerCapId as string).toBe(OWNER_CAP_ID as string);
		expect(result.publisherCapId as string).toBe(PUBLISHER_CAP_ID as string);
	});

	test("rejects an empty slug client-side", async () => {
		const adapter = makeAdapter({
			digest: "x",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			createPublication(adapter, CONFIG, { name: "P", slug: "" }),
		).rejects.toThrow(ValidationError);
		expect(adapter.signAndExecuteTransaction).not.toHaveBeenCalled();
	});

	test("rejects an overlong slug client-side", async () => {
		const adapter = makeAdapter({
			digest: "x",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			createPublication(adapter, CONFIG, {
				name: "P",
				slug: "a".repeat(65),
			}),
		).rejects.toThrow(ValidationError);
	});

	test("rejects a slug starting with a hyphen", async () => {
		const adapter = makeAdapter({
			digest: "x",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			createPublication(adapter, CONFIG, { name: "P", slug: "-foo" }),
		).rejects.toThrow(ValidationError);
	});

	test("rejects a slug with uppercase characters", async () => {
		const adapter = makeAdapter({
			digest: "x",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			createPublication(adapter, CONFIG, { name: "P", slug: "MyPub" }),
		).rejects.toThrow(ValidationError);
	});

	test("throws TransportError when the receipt is missing a created Publication", async () => {
		const adapter = makeAdapter({
			digest: "tx-1",
			gasUsedMist: 0n,
			createdObjects: [
				created(OWNER_CAP_ID, "publication", "OwnerCap"),
				created(PUBLISHER_CAP_ID, "publication", "PublisherCap"),
			],
			deletedObjects: [],
		});
		await expect(
			createPublication(adapter, CONFIG, { name: "P", slug: "p" }),
		).rejects.toThrow(TransportError);
	});
});

describe("deletePublication", () => {
	test("returns a receipt when the publication has no collections", async () => {
		const reader = makeReader(emptyPublication());
		const adapter = makeAdapter({
			digest: "tx-del",
			gasUsedMist: 200n,
			createdObjects: [],
			deletedObjects: [],
		});
		const result = await deletePublication(reader, adapter, CONFIG, {
			publicationId: PUBLICATION_ID,
			ownerCapId: OWNER_CAP_ID,
		});
		expect(result.digest).toBe("tx-del");
		expect(result.gasUsedMist).toBe(200n);
	});

	test("rejects without spending gas when the publication still has collections", async () => {
		const publication = emptyPublication();
		const reader = makeReader({
			...publication,
			collections: [
				{
					name: "blog",
					storageMode: "blog" as never,
					nextEntryId: 0,
					entriesTableId: toSuiObjectId(
						"0x000000000000000000000000000000000000000000000000000000000000ffff",
					),
				},
			],
		});
		const adapter = makeAdapter({
			digest: "x",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			deletePublication(reader, adapter, CONFIG, {
				publicationId: PUBLICATION_ID,
				ownerCapId: OWNER_CAP_ID,
			}),
		).rejects.toThrow(ValidationError);
		expect(adapter.signAndExecuteTransaction).not.toHaveBeenCalled();
	});

	test("propagates NotFoundError from the reader", async () => {
		const reader: PublicationReader = {
			getPublication: mock(async () => {
				throw new NotFoundError("publication", PUBLICATION_ID);
			}),
			listPublicationsOwnedBy: mock(async () => ({
				results: [],
				nextCursor: null,
			})),
			getPublisherCap: mock(async () => {
				throw new Error("not used in publication tests");
			}),
			listPublisherCapsOwnedBy: mock(async () => ({
				results: [],
				nextCursor: null,
			})),
			getEntry: mock(async () => {
				throw new Error("not used in publication tests");
			}),
			getRevision: mock(async () => {
				throw new Error("not used in publication tests");
			}),
			listEntries: mock(async () => ({ results: [], nextCursor: null })),
			scanEntries: () => ({
				async *[Symbol.asyncIterator]() {
					/* empty */
				},
			}),
		};
		const adapter = makeAdapter({
			digest: "x",
			gasUsedMist: 0n,
			createdObjects: [],
			deletedObjects: [],
		});
		await expect(
			deletePublication(reader, adapter, CONFIG, {
				publicationId: PUBLICATION_ID,
				ownerCapId: OWNER_CAP_ID,
			}),
		).rejects.toThrow(NotFoundError);
	});
});

describe("transferOwnership", () => {
	test("returns a receipt", async () => {
		const adapter = makeAdapter({
			digest: "tx-xfer",
			gasUsedMist: 100n,
			createdObjects: [],
			deletedObjects: [],
		});
		const result = await transferOwnership(adapter, CONFIG, {
			ownerCapId: OWNER_CAP_ID,
			recipient: RECIPIENT,
		});
		expect(result.digest).toBe("tx-xfer");
		expect(result.gasUsedMist).toBe(100n);
	});

	test("propagates TransportError from the adapter", async () => {
		const adapter = makeFailingAdapter(new TransportError("rpc down"));
		await expect(
			transferOwnership(adapter, CONFIG, {
				ownerCapId: OWNER_CAP_ID,
				recipient: RECIPIENT,
			}),
		).rejects.toThrow(TransportError);
	});
});
