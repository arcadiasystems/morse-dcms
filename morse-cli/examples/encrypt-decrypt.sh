#!/usr/bin/env bash
#
# Encrypt content with Seal and decrypt it back. Encrypted entries are stored as
# drafts (never public on-chain); access is via decrypt plus a PublisherCap.
# Uses the active context, so no object ids are typed.
#
# Prerequisites: morse on PATH, an imported active account, testnet SUI for gas,
# WAL for Walrus uploads, and jq.

set -euo pipefail

slug="encrypted-$(date +%s)"
tmp=$(mktemp -d)
echo "members only: the secret recipe" >"$tmp/secret.txt"

# create selects the new publication and collection as active.
morse publication create --name "Encrypted Demo" --slug "$slug"
morse collection create private --mode blob

# Encrypt, upload, and add as a new entry. The output includes the generated
# sealId (hex) in --json.
entry_id=$(morse --json entry add-encrypted members --file "$tmp/secret.txt" |
	jq -r .entryId)
echo "encrypted entry #$entry_id"

# Decrypt it back. This signs a short-lived SessionKey with the active account
# and recovers the plaintext to a file.
morse entry decrypt "$entry_id" --out "$tmp/recovered.txt"
cat "$tmp/recovered.txt"

# Teardown.
morse -y entry delete "$entry_id"
morse -y collection delete private
morse -y publication delete

rm -rf "$tmp"
echo "done"
