#!/usr/bin/env bash
#
# Owner delegates write access to a publisher, then revokes it. This is the
# Morse role model: one OwnerCap (governance) issues PublisherCaps (delegated
# writers, the "sub-owners"). The cap lifecycle here is on-chain only, so it
# does not depend on Walrus.
#
# The active account is the OWNER. PUBLISHER_ADDR is the delegate Sui address.
# To actually exercise the delegate write, set PUBLISHER_KEY to their secret and
# adapt the commented block below.
#
# Prerequisites: morse on PATH, an imported owner account, testnet SUI, and jq.

set -euo pipefail

: "${PUBLISHER_ADDR:?set PUBLISHER_ADDR to the delegate Sui address}"

slug="delegation-$(date +%s)"

# create selects the new publication as the active publication.
morse publication create --name "Delegation Demo" --slug "$slug"

# Owner issues a PublisherCap bound to the delegate's address (active publication).
cap=$(morse --json cap issue "$PUBLISHER_ADDR" | jq -r .publisherCapId)
echo "issued publisher cap: $cap"

# Both caps (the owner's own from create, and the delegate's) are now visible.
morse cap list "$PUBLISHER_ADDR"

# The delegate would now write, signing with their own key. The active
# publication and the delegate PublisherCap are both auto-resolved. Sketch:
#   - export MORSE_PUBLICATION to the publication id (see: morse --json status)
#   - export MORSE_PRIVATE_KEY to PUBLISHER_KEY for the delegate commands
#   - run: morse collection create posts --mode blob
#   - run: morse entry add delegated --file <path> -C posts

# Owner revokes the delegate's cap; further writes with it abort on-chain
# (EPublisherCapRevoked).
morse cap revoke "$cap" --yes
echo "revoked $cap"

# Teardown (no collection was created in the default path).
morse publication delete --yes
echo "done"
