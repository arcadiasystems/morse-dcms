#!/usr/bin/env bash
#
# Encrypt content with Seal and decrypt it back, then release the plaintext on
# the same entry. An encrypted revision stays a draft. A public revision is a
# new, unencrypted revision beside it. Access to the draft is via decrypt plus
# a PublisherCap. Uses the active context, so no object ids are typed.
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

# Release the same plaintext on this entry. The encrypted draft's blob is
# ciphertext, so publish the file rather than reusing the draft.
morse revision publish-direct "$entry_id" --file "$tmp/secret.txt"
morse entry read "$entry_id" --out "$tmp/public.txt"
diff "$tmp/secret.txt" "$tmp/public.txt"

# A later encrypted draft stays off the public head. entry read still returns
# the public revision; decrypt the new draft by index.
echo "updated internal note" >"$tmp/note.txt"
morse revision append-encrypted-draft "$entry_id" --file "$tmp/note.txt"
morse entry read "$entry_id" --out "$tmp/still-public.txt"
diff "$tmp/secret.txt" "$tmp/still-public.txt"
morse entry decrypt "$entry_id" 2 --out "$tmp/note.recovered.txt"
diff "$tmp/note.txt" "$tmp/note.recovered.txt"

# Teardown.
morse -y entry delete "$entry_id"
morse -y collection delete private
morse -y publication delete

rm -rf "$tmp"
echo "done"
