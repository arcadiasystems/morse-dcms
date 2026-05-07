/**
 * BCS schemas mirroring the on-chain Move types in `morse-contracts/entry.move`.
 * Used to decode dynamic-field values returned by the Sui gRPC client. Every
 * struct ordering must match the Move source byte-for-byte; reordering fields
 * silently corrupts the parse.
 */

import { type BcsType, bcs } from "@mysten/sui/bcs";

/** `BlobRef::Blob(ID)` carries a 32-byte address; `QuiltPatch(vector<u8>)` carries 37 raw bytes. */
export const BlobRefBcs = bcs.enum("BlobRef", {
	Blob: bcs.Address,
	QuiltPatch: bcs.vector(bcs.u8()),
});

export const EntryRevisionBcs = bcs.struct("EntryRevision", {
	blob_ref: BlobRefBcs,
	content_type: bcs.string(),
	encrypted: bcs.bool(),
	access_policy: bcs.u8(),
	seal_id: bcs.option(bcs.vector(bcs.u8())),
	author: bcs.Address,
});

export const EntryBcs = bcs.struct("Entry", {
	name: bcs.string(),
	revisions: bcs.vector(EntryRevisionBcs),
	draft_head: bcs.option(bcs.u64()),
	public_head: bcs.option(bcs.u64()),
});

/** Parse a Move `u64` dynamic-field name (the `entry_id`) from BCS bytes. */
export const EntryIdBcs: BcsType<string, string | number | bigint> = bcs.u64();
