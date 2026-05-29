#!/usr/bin/env bash
#
# Full solo lifecycle using the active context: create a publication and a blob
# collection (both auto-selected), add an entry, read it back, publish a
# revision, then tear everything down. No object ids are typed.
#
# Prerequisites: morse on PATH, an imported active account (morse account
# import), testnet SUI for gas, WAL for the Walrus upload, and jq.

set -euo pipefail

slug="lifecycle-$(date +%s)"

# create selects the new publication as the active publication.
morse publication create --name "Lifecycle Demo" --slug "$slug"

# create selects the new collection as the active collection.
morse collection create posts --mode blob

payload=$(mktemp)
echo "hello morse" >"$payload"
entry=$(morse --json entry add first-post --file "$payload" | jq -r .entryId)
echo "entry: #$entry"

morse entry get "$entry"

# Append a second revision with new content.
echo "hello morse, revised" >"$payload"
morse revision publish-direct "$entry" --file "$payload"

# Teardown (uses the active context). A publication must be empty before
# deletion, so delete the entry, then the collection, then the publication.
morse entry delete "$entry" --yes
morse collection delete posts --yes
morse publication delete --yes

rm -f "$payload"
echo "done"
