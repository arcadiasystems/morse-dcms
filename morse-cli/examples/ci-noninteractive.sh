#!/usr/bin/env bash
#
# Non-interactive usage for CI: authenticate with an env var, skip confirmations
# with --yes, and parse machine-readable --json output. No prompts, no keystore.
#
# Required env: MORSE_PRIVATE_KEY (a suiprivkey... secret). MORSE_NETWORK
# defaults to testnet. Requires jq and testnet SUI for gas.

set -euo pipefail

: "${MORSE_PRIVATE_KEY:?set MORSE_PRIVATE_KEY to a suiprivkey... secret}"
export MORSE_NETWORK="${MORSE_NETWORK:-testnet}"

# Derive the acting address from the key (no keystore unlock needed).
echo "acting as: $(morse account show)"

# Create a publication and capture its id from JSON.
pub=$(morse --json publication create --name "CI Demo" --slug "ci-$(date +%s)" |
	jq -r .publicationId)
echo "created: $pub"

# Lists are JSON too; count owned publications.
count=$(morse --json publication list | jq '.results | length')
echo "owned publications: $count"

# Tear down without prompts (--yes is a global flag, before the subcommand).
morse --yes publication delete "$pub"

# Exit codes are scriptable. A missing object returns 3 (not found). Capture the
# code with `|| code=$?` so `set -e` does not abort on the expected failure.
missing=0x0000000000000000000000000000000000000000000000000000000000000000
code=0
morse publication get "$missing" >/dev/null 2>&1 || code=$?
echo "not-found exit code: $code"
[ "$code" -eq 3 ] || {
	echo "expected exit 3, got $code"
	exit 1
}
echo "done"
