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

import type { KeyServerConfig, SessionKey } from "@mysten/seal";
import type { PublicationId, PublisherCapId, SealId } from "morse-sdk";
import {
	addEncryptedEntry,
	appendEncryptedDraftRevision,
	buildPublisherSealId,
	DefaultSealAdapter,
	DefaultWalrusWriteAdapter,
} from "morse-sdk";
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
 * Build the Seal and Walrus adapters once per encryption flow. `seal` carries
 * the morse package id, the key-server list, and the TSS threshold. `walrus`
 * is constructed against the Walrus testnet (Walrus's network parameter
 * accepts `"mainnet" | "testnet"` only, so we don't thread `ctx.config.network`
 * through; production code with a non-testnet morseConfig would map
 * accordingly).
 */
function buildAdapters(
	ctx: ExampleContext,
	keyServers: KeyServerConfig[],
): {
	seal: DefaultSealAdapter;
	walrus: DefaultWalrusWriteAdapter;
} {
	const seal = DefaultSealAdapter.fromMorseConfig(
		ctx.config,
		{ serverConfigs: keyServers, threshold: 2 },
		ctx.client,
	);
	const walrus = DefaultWalrusWriteAdapter.fromConfig(
		{ network: "testnet", suiClient: ctx.client },
		ctx.keypair,
	);
	return { seal, walrus };
}

/**
 * Encrypt a payload, upload the ciphertext to Walrus, and add an encrypted
 * entry referencing it. The contract stores `encrypted=true` and the
 * `sealId` bytes per revision; `accessPolicy` is hardcoded to Publisher
 * (Subscription is reserved for future work).
 *
 * `fromMorseConfig` picks `originalPackageId ?? packageId` automatically;
 * passing the post-upgrade `packageId` to `fromConfig` directly would
 * silently produce ciphertexts that become undecryptable across upgrades.
 */
export async function publishEncryptedEntry(
	ctx: ExampleContext,
	args: {
		publicationId: PublicationId;
		publisherCapId: PublisherCapId;
		plaintext: Uint8Array;
		keyServers: KeyServerConfig[];
	},
): Promise<{ entryId: number; sealId: SealId }> {
	const { seal, walrus } = buildAdapters(ctx, args.keyServers);

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
		keyServers: KeyServerConfig[];
	},
): Promise<{ revisionId: number; sealId: SealId }> {
	const { seal, walrus } = buildAdapters(ctx, args.keyServers);

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
		keyServers: KeyServerConfig[];
	},
): Promise<Uint8Array> {
	const { seal } = buildAdapters(ctx, args.keyServers);
	return seal.decrypt(args.ciphertext, {
		sessionKey: args.sessionKey,
		sealId: args.sealId,
		publisherCapId: args.publisherCapId,
	});
}
