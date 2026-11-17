# Releasing

`@arcadiasystems/morse-sdk` and `@arcadiasystems/morse-cli` are published to npm by [`.github/workflows/release.yml`](./.github/workflows/release.yml) when a release tag is pushed. Nobody runs `npm publish` by hand, and there is no npm token: the workflow authenticates with [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), and npm attaches a provenance statement to each release.

| Package | Directory | Tag |
| --- | --- | --- |
| `@arcadiasystems/morse-sdk` | `morse-sdk` | `v<version>`, for example `v0.12.0` |
| `@arcadiasystems/morse-cli` | `morse-cli` | `morse-cli-v<version>`, for example `morse-cli-v0.14.0` |

One tag releases one package. When a CLI release needs a new SDK, release the SDK first: the published CLI installs the SDK from npm, and the workflow refuses a CLI whose `@arcadiasystems/morse-sdk` range no published SDK satisfies.

## Steps

1. **Open a pull request** that bumps `version` in the package's `package.json` and adds the version's section to its `CHANGELOG.md`, headed `## [x.y.z] - YYYY-MM-DD`. The package's docs gate, which CI runs, fails until the CHANGELOG and README agree with the new version.
2. **Merge it** into `main`.
3. **Tag the merged commit and push the tag.**

   ```sh
   git switch main && git pull
   git tag v0.12.0              # or: git tag morse-cli-v0.14.0
   git push origin v0.12.0
   ```

4. **Wait for the `verify and pack` job**, then **approve the `npm-publish` environment** on the workflow run. The publish job does not start until a required reviewer approves it.
5. **Check the result**: the new version on npm, with its provenance badge, and the GitHub release for the tag.

## What the workflow verifies

Before anyone is asked to approve, `verify and pack` fails the run unless all of these hold:

- The tag is `v<x.y.z>` or `morse-cli-v<x.y.z>`, with a plain `x.y.z` version. Pre-release versions are not supported.
- The tagged commit is on `main`.
- The tag's version equals `version` in the package's `package.json`.
- That version is not on npm yet.
- For the CLI, a published SDK satisfies its `@arcadiasystems/morse-sdk` range.
- `bun install --frozen-lockfile` succeeds, and the package's `prepublishOnly` script passes: lint, typecheck, docs gate, tests and a fresh build. For the CLI, the workspace SDK is built first, as in CI.
- The packed `package.json` contains no `workspace:` dependency.

It then packs the tarball with `npm pack`. After approval, `publish to npm` publishes that exact tarball and runs no code from the repository. `GitHub release` then creates the release for the tag, titled like `morse-sdk v0.12.0`, with the version's CHANGELOG section as its notes. If a draft release for the tag already exists, it is published with those notes instead.

## When a run fails

- **Before the publish**: nothing was released. Fix the cause in a pull request. If the fix changes the commit to release, the tag has to move to the new commit, which means deleting and re-pushing it; do that deliberately, and only while the version is not on npm.
- **In `GitHub release`**: the package is already on npm. Re-run that job only; do not push the tag again.

npm never lets a version be published twice, so a bad release is fixed by a new patch version, not by re-running.

## One-time setup

**GitHub.** Create an environment named `npm-publish` (Settings, Environments) with at least one required reviewer. Create it before the first tag is pushed: a workflow that names a missing environment makes GitHub create it with no protection. Limiting the environment's deployment tags to `v*` and `morse-cli-v*` is a sensible extra.

**npm.** On npmjs.com, add a trusted publisher to each of the two packages (package Settings, Trusted Publisher, GitHub Actions):

| Field | Value |
| --- | --- |
| Organization or user | `arcadiasystems` |
| Repository | `morse-dcms` |
| Workflow filename | `release.yml` |
| Environment name | `npm-publish` |
| Allowed actions | include `npm publish` |

Things npm does not tell you when you save the form:

- Every field is case-sensitive and is checked only at publish time. A mismatch shows up as an authentication error on the first release.
- New configurations allow only `npm stage publish` unless `npm publish` is also selected. This workflow runs `npm publish`.
- A new configuration expires if no publish succeeds within 2 days. Set it up shortly before the first release through the workflow.
- Renaming `release.yml` or the `npm-publish` environment breaks the match. Delete and recreate the trusted publisher if either has to change.

Once a release has gone through the workflow, set each package's publishing access to "Require two-factor authentication and disallow tokens" and revoke any npm automation tokens that were used for publishing.
