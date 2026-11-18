/** Shared Seal identity construction for encrypted writes. */

import {
	buildPublisherSealId,
	type PublicationId,
	type SealId,
} from "@arcadiasystems/morse-sdk";

// 16 random bytes is the typical Seal nonce length; the Move layer requires >= 1.
const SEAL_NONCE_BYTES = 16;

/** A fresh publisher-policy Seal id for one encrypted revision. */
export function freshPublisherSealId(publicationId: PublicationId): SealId {
	return buildPublisherSealId(
		publicationId,
		crypto.getRandomValues(new Uint8Array(SEAL_NONCE_BYTES)),
	);
}
