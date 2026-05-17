/**
 * Encrypted entries: build a Seal identity, encrypt client-side, upload
 * ciphertext to Walrus, attach to an encrypted entry, decrypt later via a
 * SessionKey.
 *
 * On-chain invariants enforced by the Move contract:
 *
 *   sealId = publication_id (32 bytes) || policy_tag (1 byte = 1) || nonce (>= 1 byte)
 *
 * The publication_id prefix scopes the identity to a single publication
 * (cross-publication forgery prevention). The policy_tag scopes it to the
 * publisher policy entrypoint (`seal_approve_publisher`).
 *
 * No encrypted publish path: `publishFromDraft` and `publishDirect` always
 * write non-encrypted public revisions. Encrypted content stays as drafts.
 *
 * Function names in this file are illustrative.
 */

import type {
	PublicationId,
	PublisherCapId,
	SealId,
} from "@arcadiasystems/morse-sdk";
import {
	addEncryptedEntry,
	addEncryptedEntryFromBytes,
	appendEncryptedDraftRevision,
	buildPublisherSealId,
	DefaultSealAdapter,
	DefaultWalrusWriteAdapter,
} from "@arcadiasystems/morse-sdk";
import type { KeyServerConfig, SessionKey } from "@mysten/seal";
import type { ExampleContext } from "./setup.js";

/**
 * Build a per-entry Seal identity. Use a fresh nonce per identity; the same
 * nonce produces the same identity, so reuse is a deduplication signal.
 *
 * `crypto.getRandomValues(new Uint8Array(16))` is a sensible default.
 *
 * Node compatibility: `crypto` is a global on Node 19+ and in browsers. On
 * Node 18 (still common), `import { webcrypto as crypto } from "node:crypto"`
 * exposes the same API. The Move layer requires nonce length >= 1 byte; the
 * SDK requires the same.
 */
export function newSealIdFor(publicationId: PublicationId): SealId {
	const nonce = crypto.getRandomValues(new Uint8Array(16));
	return buildPublisherSealId(publicationId, nonce);
}

/**
 * Build the Seal and Walrus adapters once per encryption flow. Defaults the
 * Seal `serverConfigs` and `threshold` from `ctx.config.sealKeyServers` (the
 * canonical testnet allowlist baked into morse-sdk). Walrus is constructed
 * against the Walrus testnet — Walrus's `network` parameter accepts only
 * `"mainnet" | "testnet"`, so production code with a non-testnet morseConfig
 * maps `ctx.config.network` accordingly.
 */
function buildAdapters(ctx: ExampleContext): {
	seal: DefaultSealAdapter;
	walrus: DefaultWalrusWriteAdapter;
} {
	const seal = DefaultSealAdapter.fromMorseConfig(ctx.config, {}, ctx.client);
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);
	return { seal, walrus };
}

/**
 * Encrypt a payload, upload the ciphertext to Walrus, and add an encrypted
 * entry referencing it in 2 wallet popups (encrypt is popup-free; popups
 * are register_blob then certify_blob + add_entry combined). The contract
 * stores `encrypted=true` and the `sealId` bytes per revision;
 * `accessPolicy` is hardcoded to Publisher (Subscription is reserved for
 * future work).
 */
export async function publishEncryptedEntry(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		plaintext: Uint8Array;
	},
): Promise<{ entryId: number; sealId: SealId }> {
	const { seal, walrus } = buildAdapters(ctx);
	const sealId = newSealIdFor(args.publicationId);
	const result = await addEncryptedEntryFromBytes(ctx.adapter, ctx.config, {
		walrus,
		seal,
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		collectionName: "secret-blog",
		name: "private-doc",
		plaintext: args.plaintext,
		contentType: "application/octet-stream",
		sealId,
		upload: { epochs: 3, deletable: true },
	});
	return { entryId: result.entryId, sealId };
}

/**
 * Lower-level alternative when ciphertext already exists (separately
 * encrypted, separately uploaded). Uses `addEncryptedEntry` with a
 * pre-uploaded `blobObjectId`. Prefer `publishEncryptedEntry` above for
 * the typical encrypt-and-publish flow.
 */
export async function publishEncryptedEntryFromExistingBlob(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		plaintext: Uint8Array;
	},
): Promise<{ entryId: number; sealId: SealId }> {
	const { seal, walrus } = buildAdapters(ctx);
	const sealId = newSealIdFor(args.publicationId);
	const { ciphertext } = await seal.encrypt(args.plaintext, { sealId });
	const blob = await walrus.uploadBlob(ciphertext, {
		epochs: 3,
		deletable: true,
	});
	const result = await addEncryptedEntry(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		collectionName: "secret-blog",
		name: "private-doc",
		blobObjectId: blob.blobObjectId,
		contentType: "application/octet-stream",
		sealId,
	});
	return { entryId: result.entryId, sealId };
}

/**
 * Append a fresh encrypted draft to an existing entry. Each revision carries
 * its own `sealId`, so the new draft can use a different identity from the
 * prior one (useful for key rotation per revision).
 */
export async function appendEncryptedDraft(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		entryId: number;
		plaintext: Uint8Array;
	},
): Promise<{ revisionId: number; sealId: SealId }> {
	const { seal, walrus } = buildAdapters(ctx);

	const sealId = newSealIdFor(args.publicationId);
	const { ciphertext } = await seal.encrypt(args.plaintext, { sealId });
	const blob = await walrus.uploadBlob(ciphertext, {
		epochs: 3,
		deletable: true,
	});
	const result = await appendEncryptedDraftRevision(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		collectionName: "secret-blog",
		entryId: args.entryId,
		blobObjectId: blob.blobObjectId,
		contentType: "application/octet-stream",
		sealId,
	});
	return { revisionId: result.revisionId, sealId };
}

/**
 * Decrypt a previously-stored ciphertext. The consumer brings:
 * - `sessionKey`: built via `SessionKey.create(...)` from `@mysten/seal`,
 *   which requires the user's wallet to sign a personal message. The SDK
 *   never silently builds a SessionKey from private material.
 * - `sealId`: the identity bound to the revision (read it from
 *   `Revision.sealId` via the reader; it is already branded `SealId | null`).
 * - `publisherCapId`: the cap that authorizes decryption. The Seal key
 *   servers verify it is active (not in the publication's denylist).
 */
export async function decryptCiphertext(
	ctx: ExampleContext,
	args: {
		ciphertext: Uint8Array;
		sessionKey: SessionKey;
		sealId: SealId;
		publisherCapId: PublisherCapId;
	},
): Promise<Uint8Array> {
	const { seal } = buildAdapters(ctx);
	return seal.decrypt(args.ciphertext, {
		sessionKey: args.sessionKey,
		sealId: args.sealId,
		publisherCapId: args.publisherCapId,
	});
}

/**
 * Power-user variant: pass a custom Seal server set (paid plans, alternate
 * trust assumptions, region pinning). The default `publishEncryptedEntry`
 * inherits from `morseConfig.sealKeyServers` and is the right path for
 * standard testnet/mainnet flows.
 */
export async function publishEncryptedEntryWithCustomServers(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		plaintext: Uint8Array;
		serverConfigs: KeyServerConfig[];
		threshold?: number;
	},
): Promise<{ entryId: number; sealId: SealId }> {
	const seal = DefaultSealAdapter.fromMorseConfig(
		ctx.config,
		{
			serverConfigs: args.serverConfigs,
			...(args.threshold === undefined ? {} : { threshold: args.threshold }),
		},
		ctx.client,
	);
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);
	const sealId = newSealIdFor(args.publicationId);
	const { ciphertext } = await seal.encrypt(args.plaintext, { sealId });
	const blob = await walrus.uploadBlob(ciphertext, {
		epochs: 3,
		deletable: true,
	});
	const result = await addEncryptedEntry(ctx.adapter, ctx.config, {
		publicationId: args.publicationId,
		publisherCapId: args.publisherCapId,
		collectionName: "secret-blog",
		name: "private-doc",
		blobObjectId: blob.blobObjectId,
		contentType: "application/octet-stream",
		sealId,
	});
	return { entryId: result.entryId, sealId };
}
