/**
 * BCS schemas mirroring the on-chain Move types in `morse-contracts/entry.move`.
 * Used to decode dynamic-field values returned by the Sui gRPC client. Every
 * struct ordering must match the Move source byte-for-byte; reordering fields
 * silently corrupts the parse.
 *
 * Each schema is exported as a `BcsType<Parsed, unknown>`. The explicit
 * annotation prevents tsc from emitting declaration files that reference
 * `@mysten/bcs` internal helpers via `@mysten/sui`'s transitive dependency
 * (TS2742). The `unknown` input shape is intentional: the SDK only calls
 * `.parse()` on these schemas; we never `.serialize()` an Entry locally, so
 * narrowing the input type would only constrain a code path we do not use.
 */

import { type BcsType, bcs } from "@mysten/sui/bcs";

/** Parsed shape of a `BlobRef::*` move enum value. */
export type ParsedBlobRef =
	| {
			readonly $kind: "Blob";
			readonly Blob: string;
			readonly QuiltPatch?: never;
	  }
	| {
			readonly $kind: "QuiltPatch";
			readonly Blob?: never;
			readonly QuiltPatch: number[];
	  };

/** Parsed shape of a `Revision` struct. */
export interface ParsedEntryRevision {
	readonly blob_ref: ParsedBlobRef;
	readonly content_type: string;
	readonly encrypted: boolean;
	readonly access_policy: number;
	readonly seal_id: number[] | null;
	readonly author: string;
}

/** Parsed shape of the `Entry` struct returned by `EntryBcs.parse`. */
export interface ParsedEntry {
	readonly name: string;
	readonly revisions: readonly ParsedEntryRevision[];
	readonly draft_head: string | null;
	readonly public_head: string | null;
}

/** `BlobRef::Blob(ID)` carries a 32-byte address; `QuiltPatch(vector<u8>)` carries 37 raw bytes. */
export const BlobRefBcs = bcs.enum("BlobRef", {
	Blob: bcs.Address,
	QuiltPatch: bcs.vector(bcs.u8()),
}) as unknown as BcsType<ParsedBlobRef, unknown>;

export const EntryRevisionBcs = bcs.struct("EntryRevision", {
	blob_ref: BlobRefBcs,
	content_type: bcs.string(),
	encrypted: bcs.bool(),
	access_policy: bcs.u8(),
	seal_id: bcs.option(bcs.vector(bcs.u8())),
	author: bcs.Address,
}) as unknown as BcsType<ParsedEntryRevision, unknown>;

export const EntryBcs = bcs.struct("Entry", {
	name: bcs.string(),
	revisions: bcs.vector(EntryRevisionBcs),
	draft_head: bcs.option(bcs.u64()),
	public_head: bcs.option(bcs.u64()),
}) as unknown as BcsType<ParsedEntry, unknown>;

/** Parse a Move `u64` dynamic-field name (the `entry_id`) from BCS bytes. */
export const EntryIdBcs: BcsType<string, string | number | bigint> = bcs.u64();
