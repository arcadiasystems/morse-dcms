# morse-cli examples

Runnable shell recipes for common workflows. They complement the linear
walkthrough in [`../docs/QUICKSTART.md`](../docs/QUICKSTART.md) by showing
multi-party and scripted scenarios.

| Script | Shows |
| --- | --- |
| [`lifecycle.sh`](./lifecycle.sh) | Full solo flow: create publication, collection, entry, read, revision, teardown. |
| [`content.sh`](./content.sh) | Upload an image and a post, publish a revision, fetch content back, get a link, remove a collection. |
| [`encrypt-decrypt.sh`](./encrypt-decrypt.sh) | Encrypt content with Seal and decrypt it back. |
| [`delegation.sh`](./delegation.sh) | Owner issues a PublisherCap to a delegate, then revokes it (the sub-owner model). |
| [`ci-noninteractive.sh`](./ci-noninteractive.sh) | Env-var auth, `--yes`, and parsing `--json` output. No prompts. |
| [`files.sh`](./files.sh) | RecipientFile round-trip: upload an encrypted file, download/decrypt via its share string, manage recipients, plus a public file; teardown. |

Not shown because the contract does not support it: renaming a publication. A
publication's name and slug are immutable (the slug is the registry's unique
key); there is no `rename` command.

## Prerequisites

- `morse` on your `PATH` (`bun link` from `morse-cli/`, or alias
  `morse="bun src/index.ts"`).
- An imported account (`morse account import`) for the interactive scripts, or
  `MORSE_PRIVATE_KEY` set for `ci-noninteractive.sh`.
- Testnet SUI for gas. The content steps in `lifecycle.sh` also need WAL.
- [`jq`](https://jqlang.github.io/jq/) for the scripts that parse `--json`.

Run any script with `bash examples/<name>.sh`. They create and then delete their
own on-chain state.
