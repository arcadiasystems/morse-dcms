# Morse CLI quick start

This walks a new user from an empty machine to a published, readable entry on
Sui testnet, then tears it down. Every command is copy-pasteable; expected
output is shown beneath each step. Replace IDs in later steps with the ones your
own runs print.

## 0. Prerequisites

- Install [Bun](https://bun.sh) >= 1.2.
- Have a Sui testnet keypair. If you use the Sui CLI, export one with
  `sui keytool export --key-identity <alias>` to get a `suiprivkey1...` string.
- Fund the address with testnet SUI ([faucet](https://faucet.sui.io/)) for gas,
  and with WAL ([Walrus faucet](https://docs.walrus.site/usage/web-tool.html))
  for content uploads.

Install the CLI:

```sh
bun add -g @arcadiasystems/morse-cli
morse --version
```

## 1. Create a profile

A profile pins the network. The first profile you add becomes the default.

```sh
morse config add testnet --network testnet
```
```
Saved profile "testnet" (testnet).
```

## 2. Import your key

`account import` prompts for the secret key and a keystore password, both hidden.
The key is encrypted at rest (scrypt + AES-256-GCM) and never stored in plaintext.

```sh
morse account import
```
```
Private key (suiprivkey...):
New keystore password:
Confirm password:
Imported account 0x830b... (profile "testnet").
```

Confirm the active account:

```sh
morse account show
```
```
0x830bd528f47068329ddbc9fcbd1f0ead051e01b0538897bb260c4c299f44ba3e
```

## 3. Create a publication

`publication create` selects the new publication as your active one, so the next
steps need no ids.

```sh
morse publication create --name "My Blog" --slug my-blog
```
```
Created "My Blog" (0x9f3c...)
  ownerCap:     0x1205...
  publisherCap: 0x6b6c...
  tx:           EScsJc...
Selected as the active publication.
```

Check the active context any time:

```sh
morse status
```
```
profile:     testnet
network:     testnet
account:     0x830b...
publication: 0x9f3c...
collection:  (none)
```

## 4. Create a collection

Collections group entries and fix a storage mode (`blob` or `quilt`) at creation.
This one becomes the active collection.

```sh
morse collection create posts --mode blob
```
```
Created collection "posts". Selected as the active collection. (tx: DacDfQ...)
```

## 5. Add an entry from a file

This uploads the file to Walrus and attaches it as the first revision of a new
entry. The active publication and collection are used; content type is inferred
from the extension.

```sh
echo "hello morse" > post.txt
morse entry add first-post --file post.txt
```
```
Uploading 12 bytes to Walrus...
Added entry #0 "first-post". (tx: D9Yfjk...)
```

## 6. Read it back

```sh
morse entry get 0
```
```
#0 first-post
publicHead: 0  draftHead: none
revisions:  1
  [0] text/plain (blob 0x57fb...) by 0x830b...
```

List everything in the active collection:

```sh
morse entry list
```

## 7. Publish a new revision

Append another version of the content as a public revision:

```sh
echo "hello morse, revised" > post-v2.txt
morse revision publish-direct 0 --file post-v2.txt
```
```
Uploading 21 bytes to Walrus...
Blob uploaded (0x...). Submitting transaction...
Published revision #1 on entry #0. (tx: ...)
```

## 8. (Optional) Encrypted content

Add an encrypted entry and decrypt it back. Encryption uses Seal; decryption
signs a short-lived SessionKey with your active account.

```sh
echo "for subscribers only" > secret.txt
morse entry add-encrypted members --file secret.txt
```
```
Encrypting and uploading 21 bytes...
Added encrypted entry #1 "members". (tx: ...)
```
```sh
morse entry decrypt 1 --out recovered.txt
cat recovered.txt
```
```
Fetching ciphertext from Walrus...
Signing a SessionKey with the active account...
Wrote 21 bytes to recovered.txt.
for subscribers only
```

## 9. Tear down

Delete in reverse order: entries, then the collection, then the publication. A
publication must be empty (no collections) before it can be deleted. These use
the active context; `publication delete` clears the active publication.

```sh
morse entry delete 0 --yes
morse entry delete 1 --yes
morse collection delete posts --yes
morse publication delete --yes
```
```
Deleted entry #0. (tx: ...)
Deleted entry #1. (tx: ...)
Deleted collection "posts". (tx: ...)
Deleted 0x9f3c.... (tx: ...)
```

To work on a different existing publication later, switch context with
`morse use <slug-or-id>` (and optionally a collection): `morse use my-blog posts`.

## Scripting tips

- Add `--json` (before the subcommand) for machine-readable output, and parse
  stdout only. Example: `morse --json publication list | jq '.results[].publicationId'`.
- In CI, set `MORSE_PRIVATE_KEY` and `MORSE_KEYSTORE_PASSWORD` so commands run
  without prompts, and pass `--yes` to skip confirmations.
- Check `$?`: `0` success, `1` generic error (contract abort, validation), `2`
  usage/declined, `3` not found, `4` auth, `5` network. See the README for the
  full table.

The output shown above is illustrative; exact IDs, digests, and the human-text
format may differ between runs and releases. Parse `--json` output for anything
a script depends on.
