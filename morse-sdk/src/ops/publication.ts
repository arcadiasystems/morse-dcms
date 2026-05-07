/**
 * High-level publication ops: build a PTB, sign and execute via the wallet
 * adapter, parse the receipt into a typed result.
 */

import {
	Transaction,
	type TransactionObjectArgument,
} from "@mysten/sui/transactions";

import { toOwnerCapId, toPublicationId, toPublisherCapId } from "../codecs.js";
import type { NetworkConfig } from "../config.js";
import { ValidationError } from "../errors.js";
import {
	buildCreatePublication,
	buildDeletePublication,
	buildSharePublication,
	buildTransferOwnerCap,
	buildTransferPublisherCap,
} from "../ptb/publication.js";
import type { PublicationReader } from "../read/reader.js";
import type {
	OwnerCapId,
	PublicationId,
	PublisherCapId,
	SuiAddress,
} from "../types.js";
import type { WalletAdapter } from "../wallets/adapter.js";
import { findCreatedId } from "./internal.js";

/** Subset of `NetworkConfig` required to address the deployed contract. */
export type PublicationConfig = Pick<
	NetworkConfig,
	"packageId" | "originalPackageId" | "registryId"
>;

const MAX_SLUG_LENGTH = 64;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface CreatePublicationArgs {
	readonly name: string;
	readonly slug: string;
	readonly signal?: AbortSignal;
}

export interface CreatePublicationResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
	readonly publicationId: PublicationId;
	readonly ownerCapId: OwnerCapId;
	readonly publisherCapId: PublisherCapId;
}

/**
 * Create, share, and transfer ownership in a single atomic PTB.
 * @throws {ValidationError} If `slug` violates the on-chain format rules.
 * @throws {ContractAbortError} On Move abort (e.g. slug already taken).
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function createPublication(
	adapter: WalletAdapter,
	config: PublicationConfig,
	args: CreatePublicationArgs,
): Promise<CreatePublicationResult> {
	validateSlug(args.slug);

	const tx = new Transaction();
	const created = buildCreatePublication(tx, {
		packageId: config.packageId,
		registryId: config.registryId,
		name: args.name,
		slug: args.slug,
	});
	// new_publication returns (Publication, OwnerCap, PublisherCap); all object results.
	const publicationArg = created[0] as TransactionObjectArgument;
	const ownerCapArg = created[1] as TransactionObjectArgument;
	const publisherCapArg = created[2] as TransactionObjectArgument;
	buildSharePublication(tx, {
		packageId: config.packageId,
		publication: publicationArg,
	});
	// Caps are key-only; tx.transferObjects requires `store`. Use the contract's
	// typed transfer wrappers instead.
	buildTransferOwnerCap(tx, {
		packageId: config.packageId,
		ownerCap: ownerCapArg,
		recipient: adapter.address,
	});
	buildTransferPublisherCap(tx, {
		packageId: config.packageId,
		publisherCap: publisherCapArg,
		recipient: adapter.address,
	});

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);
	const typePrefix = config.originalPackageId ?? config.packageId;

	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
		publicationId: toPublicationId(
			findCreatedId(receipt, `${typePrefix}::publication::Publication`),
		),
		ownerCapId: toOwnerCapId(
			findCreatedId(receipt, `${typePrefix}::publication::OwnerCap`),
		),
		publisherCapId: toPublisherCapId(
			findCreatedId(receipt, `${typePrefix}::publication::PublisherCap`),
		),
	};
}

export interface DeletePublicationArgs {
	readonly publicationId: PublicationId;
	readonly ownerCapId: OwnerCapId;
	readonly signal?: AbortSignal;
}

export interface DeletePublicationResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
}

/**
 * Delete a publication. The client-side collection check is best-effort
 * pre-flight; a concurrent transaction can still add a collection between
 * the reader call and the delete, in which case the on-chain `destroy_empty`
 * abort surfaces as `ContractAbortError`.
 * @throws {ValidationError} If the publication still has collections at read time.
 * @throws {NotFoundError} If the publication does not exist.
 * @throws {ContractAbortError} On Move abort.
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function deletePublication(
	reader: PublicationReader,
	adapter: WalletAdapter,
	config: PublicationConfig,
	args: DeletePublicationArgs,
): Promise<DeletePublicationResult> {
	const publication = await reader.getPublication(
		args.publicationId,
		args.signal,
	);
	if (publication.collections.length > 0) {
		throw new ValidationError(
			`Cannot delete publication with ${publication.collections.length} collection(s); remove them first`,
			"publication.collections",
		);
	}

	const tx = new Transaction();
	buildDeletePublication(tx, {
		packageId: config.packageId,
		registryId: config.registryId,
		publicationId: args.publicationId,
		ownerCapId: args.ownerCapId,
	});

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);

	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
	};
}

export interface TransferOwnershipArgs {
	readonly ownerCapId: OwnerCapId;
	readonly recipient: SuiAddress;
	readonly signal?: AbortSignal;
}

export interface TransferOwnershipResult {
	readonly digest: string;
	readonly gasUsedMist: bigint;
}

/**
 * Transfer the OwnerCap to a new address.
 * @throws {ContractAbortError} On Move abort.
 * @throws {TransportError} On RPC, network, or response-parsing failure.
 */
export async function transferOwnership(
	adapter: WalletAdapter,
	config: PublicationConfig,
	args: TransferOwnershipArgs,
): Promise<TransferOwnershipResult> {
	const tx = new Transaction();
	buildTransferOwnerCap(tx, {
		packageId: config.packageId,
		ownerCap: args.ownerCapId,
		recipient: args.recipient,
	});

	const receipt = await adapter.signAndExecuteTransaction(tx, args.signal);

	return {
		digest: receipt.digest,
		gasUsedMist: receipt.gasUsedMist,
	};
}

function validateSlug(slug: string): void {
	if (slug.length === 0) {
		throw new ValidationError("Slug cannot be empty", "slug");
	}
	if (slug.length > MAX_SLUG_LENGTH) {
		throw new ValidationError(
			`Slug exceeds maximum length of ${MAX_SLUG_LENGTH} characters`,
			"slug",
		);
	}
	if (!SLUG_PATTERN.test(slug)) {
		throw new ValidationError(
			"Slug must contain only lowercase alphanumeric characters and hyphens, and cannot start or end with a hyphen",
			"slug",
		);
	}
}
