**Placeholder, not implemented.**

# morse-indexer

This package is meant to become the Morse event indexer: a service that follows the events emitted by the Morse Move contracts and serves read-optimized queries over that data, so client apps do not have to read every object from chain themselves. The contracts stay the source of truth; the indexer would be a convenience layer, not a gatekeeper.

None of that exists yet. `index.ts` is a `bun init` scratch script that prints the SUI balance of one hard-coded testnet address and contains no indexing logic. The package is marked `private`, is not published to npm, and stays in the bun workspace only as a reserved slot for the planned indexer.
