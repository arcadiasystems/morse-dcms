#!/usr/bin/env bash
#
# RecipientFile round-trip: upload an encrypted file, download and decrypt it
# via its share string, manage the recipient list, then show a public
# (world-readable) file. Teardown deletes what it created.
#
# Prerequisites: morse on PATH, an imported active account (morse account
# import), testnet SUI for gas, WAL for the Walrus uploads, and jq.

set -euo pipefail

# Encrypt + upload a file. The sender is always a recipient. The share string is
# printed once and is required to decrypt later; the prefix and nonce it carries
# are not recoverable from the ciphertext.
secret=$(mktemp)
echo "classified contents" >"$secret"
upload=$(morse --json file upload "$secret" --name secret.txt --encrypt)
file=$(echo "$upload" | jq -r .fileId)
share=$(echo "$upload" | jq -r .share)
echo "encrypted file: $file"
echo "share string (save this): $share"

# Download and decrypt in place (you are a recipient, and the share carries the
# file id, prefix, and nonce).
out=$(mktemp)
morse file download --share "$share" --out "$out"
echo "decrypted:"
cat "$out"

# Manage the recipient list: grant and then revoke another address.
other="0x2222222222222222222222222222222222222222222222222222222222222222"
morse file recipient add "$file" "$other"
morse file recipient list "$file"
morse file recipient remove "$file" "$other"

# A public file needs no recipients or share string; anyone can read it.
logo=$(mktemp)
echo "public bytes" >"$logo"
pub=$(morse --json file upload "$logo" --name notice.txt --public | jq -r .fileId)
morse file download "$pub" --out "$(mktemp)"

# Teardown. Deleting the metadata does not delete the Walrus blob; it expires
# on its own lease.
morse file delete "$file" --yes
morse file delete "$pub" --yes
