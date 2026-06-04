#!/usr/bin/env bash
#
# Allowlist + encrypted file round-trip: create an allowlist, add yourself as a
# member, upload an encrypted file, then download and decrypt it. Also shows a
# public (world-readable) file. Teardown deletes what it created.
#
# Prerequisites: morse on PATH, an imported active account (morse account
# import), testnet SUI for gas, WAL for the Walrus uploads, and jq.

set -euo pipefail

me=$(morse --json account show | jq -r .address)

# Create an allowlist and add yourself so you can decrypt files gated by it.
allowlist=$(morse --json allowlist create --name "team-docs-$(date +%s)" | jq -r .allowlistId)
echo "allowlist: $allowlist"
morse allowlist add-member "$me" --allowlist "$allowlist"
morse allowlist get "$allowlist"

# Encrypt + upload a file. The seal id is printed once and is required to
# decrypt later; it is not recoverable from the ciphertext.
secret=$(mktemp)
echo "classified contents" >"$secret"
upload=$(morse --json file upload "$secret" --name secret.txt --allowlist "$allowlist")
file=$(echo "$upload" | jq -r .fileId)
seal=$(echo "$upload" | jq -r .sealId)
echo "encrypted file: $file"
echo "seal id (save this): $seal"

# Download and decrypt in place (you are a member of the allowlist).
out=$(mktemp)
morse file download "$file" --seal-id "$seal" --out "$out"
echo "decrypted:"
cat "$out"

# A public file needs no allowlist or seal id; anyone can read it.
logo=$(mktemp)
echo "public bytes" >"$logo"
pub=$(morse --json file upload "$logo" --name notice.txt --public | jq -r .fileId)
morse file download "$pub" --out "$(mktemp)"

# Teardown. Deleting the metadata does not delete the Walrus blob; it expires
# on its own lease.
morse file delete "$file" --yes
morse file delete "$pub" --yes
morse allowlist delete --allowlist "$allowlist" --yes
