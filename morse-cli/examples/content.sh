#!/usr/bin/env bash
#
# Content workflow: upload an image and a post, publish a new revision, fetch
# content back ("open published"), get a shareable link, and remove the
# collection. Uses the active context, so no object ids are typed.
#
# Prerequisites: morse on PATH, an imported active account, testnet SUI for gas,
# WAL for Walrus uploads, and jq.

set -euo pipefail

slug="content-$(date +%s)"
tmp=$(mktemp -d)
printf 'PNG-placeholder-bytes' >"$tmp/logo.png"
echo "# Hello, Morse" >"$tmp/post.md"

# create selects the new publication and collection as active.
morse publication create --name "Content Demo" --slug "$slug"
morse collection create blog --mode blob

# Upload an image. Content type is inferred from .png. The human output prints a
# "view:" aggregator link; --json carries it as viewUrl. --epochs sets how long
# Walrus stores the blob (default 3); more epochs cost more WAL.
image=$(morse --json entry add logo --file "$tmp/logo.png" --epochs 5)
image_id=$(echo "$image" | jq -r .entryId)
echo "image entry #$image_id - link: $(echo "$image" | jq -r .viewUrl)"

# Upload a Markdown post (a public entry).
post_id=$(morse --json entry add hello --file "$tmp/post.md" | jq -r .entryId)

# Publish a new public revision of the post.
echo "# Hello, Morse (edited)" >"$tmp/post.md"
morse revision publish-direct "$post_id" --file "$tmp/post.md"

# Open the published content: fetch the latest revision back to a file.
morse entry read "$post_id" --out "$tmp/fetched.md"
cat "$tmp/fetched.md"

# Remove the collection: delete its entries first, then the collection.
morse -y entry delete "$image_id"
morse -y entry delete "$post_id"
morse -y collection delete blog

# Tear down the publication (uses the active context).
morse -y publication delete

rm -rf "$tmp"
echo "done"
