# Releasing Commerce

The authoritative plan lives in
[`dinkuskit/dinkuskit` `docs/plans/release-process.md`](https://github.com/dinkuskit/dinkuskit/blob/main/docs/plans/release-process.md)
(GrillTrack decisions `release-changesets-061` through
`release-branches-079`). This file is the per-repo operating summary. The
model is OpenClaw's release process: betas and stable releases come from a
`release/X.Y.Z` branch, so main never waits for a beta.

Commerce runs the same release files as `dinkuskit/payments`, with only
Commerce's names and its own bundle preparation: `scripts/release-flow.mjs`,
`scripts/release-authority-proof.mjs`, `.github/scripts/emdash-dispatch-gate.mjs`,
`.github/workflows/release.yml` and `.github/workflows/emdash-release.yml`.

| Channel | Registry package | Installed plugin ID | Version |
| --- | --- | --- | --- |
| Beta | `dinkus-commerce-beta` | `r_fjzjvld3ssb4j63o` | `X.Y.Z-beta.N` |
| Stable | `dinkus-commerce` | `r_gshdrqaldna3r7sn` | `X.Y.Z` |

All three buttons are on **Release** (`release.yml`): **Run workflow** on
`main` with `action: cut-beta`, `add-fix` or `promote`. A button run never
publishes. It pushes a version tag, and **that tag's run** publishes:
`vX.Y.Z-beta.N` to `dinkus-commerce-beta`, `vX.Y.Z` to `dinkus-commerce`.
`emdash-release.yml` has no button of its own; only `release.yml`'s tag run
calls it, so the release service connects both listings through `release.yml`.

## When to cut a beta

(`release-beta-cadence-078`.) Press Cut beta when a batch is worth giving a
store: a finished feature, or a fix a store owner would notice. There is no
calendar. Ordinary PRs merge to `main` with their changesets and ship nothing
on their own. Docs, tests and CI-only changes never get a beta, and Cut beta
refuses when nothing version-bumping has merged since the last release. One
release is on test at a time: Cut beta refuses while an earlier
`release/X.Y.Z` has no `vX.Y.Z` tag yet, and so does Add fix to beta when it would start a patch branch.

## Every pull request adds a changeset

`npm run changeset` for shipped behavior, `npx changeset --empty` for docs,
tests, or CI only. On 0.x, bug fixes are `patch` and everything else is
`minor`. CI (`changeset-check.yml`) rejects a missing changeset and any
`major` bump. Every change, including a fix for a beta on test, is a normal
PR to `main` that ClawSweeper reviews. No PR ever targets a release branch.

## 1. Cut beta

Press **Run workflow** on **Release** with `action: cut-beta`. Leave
`beta_version` blank for the next `X.Y.Z-beta.N`, or give one.

- `X.Y.Z` is the version `main`'s pending changesets would release; `N` is
  one more than the highest `vX.Y.Z-beta.*` tag or `dinkus-commerce-beta`
  record on the publisher's PDS (every page, fail-closed on lookup errors).
- It runs the unit tests and typecheck, creates `release/X.Y.Z` at `main`'s
  newest commit, and tags `vX.Y.Z-beta.N` there with the release GitHub App.
- `main` keeps taking merges from here on. They wait for the next release.

## 2. The tag run publishes the beta and starts the journeys

The `vX.Y.Z-beta.N` tag's run checks that the tag sits on `release/X.Y.Z`,
stamps the beta version into its checkout (never committed), builds the
prebundle, and publishes `dinkus-commerce-beta@X.Y.Z-beta.N`. Then its
**Start the live journeys on the beta store** job presses **Live journeys** in
[dinkuskit/live-journeys](https://github.com/dinkuskit/live-journeys/actions/workflows/live-journeys.yml)
with `beta: dinkus-commerce-beta X.Y.Z-beta.N`. That run waits for the
Registry to offer the beta, updates the beta store (beta.sm0ky.dev) to it, and
runs the `@running` journeys. It is named `Live journeys for
dinkus-commerce-beta X.Y.Z-beta.N`, and its page shows each journey's pass or
fail and the plugin versions tested. If an update asks for new permissions the
run stops and says what was asked; update the plugin by hand on the store's
Plugins page, then press Run workflow there again with the same `beta`.

The press needs the `DINKUS_LIVE_JOURNEYS_TOKEN` org secret, shared by every dinkuskit
plugin repo: a fine-grained GitHub token owned by dinkuskit whose only access is
**Actions: Read and write** on `dinkuskit/live-journeys`. Without it the
job fails after the publish, and the journeys can be started by hand with the
same `beta` input.

## 3. A fix found on the beta: Add fix to beta

Merge the fix to `main` through its normal reviewed PR. Then press **Run
workflow** with `action: add-fix`, `release_version: X.Y.Z`, and
`fix_commit` set to the fix's merge commit on `main`. It copies that exact
commit onto `release/X.Y.Z` (`git cherry-pick -x`, so the copy names its
source) and tags the next `vX.Y.Z-beta.N`, whose run publishes it and starts
the journeys again. It refuses a commit that isn't on `main`, one already on
the branch, and one that doesn't copy cleanly; then nothing is pushed. A
release-file fix is copied the same way, so the branch runs it too.

## 4. Promote

When the newest beta's journeys pass, press **Run workflow** with
`action: promote`, `beta_version: X.Y.Z-beta.N`, and `proof_ref` set to the
run's address followed by the beta version, for example
`https://github.com/dinkuskit/live-journeys/actions/runs/<run id> (X.Y.Z-beta.N @running pass)`.
The address alone has no version in it, and the gate refuses a proof that
doesn't name the beta.

The gate checks that `vX.Y.Z-beta.N` is the tip of `release/X.Y.Z` (if a
fix was added since, promote that newer beta once it passes), that `vX.Y.Z`
isn't released yet, and that the Registry holds the beta. Then it runs
`npm run release:version` on the branch (`changeset version`, the
`emdash-plugin.jsonc` version sync, a lockfile-only install) and refuses if
the branch's changesets make a different version. It opens or updates the one
`ci: release vX.Y.Z` PR to `main` from `changeset-release/main`, carrying only
the version, the `X.Y.Z` CHANGELOG section, and the removal of the changesets
that release used, with a `Release-Beta-Proof:` trailer naming the beta, its
commit and the proof. Changesets merged to `main` after the cut stay pending
for the next release.

## 5. Merge the release PR

Comment `@clawsweeper review` on the release PR; only the reviewed commit
merges, and the owner's merge is the stable publish yes. On that push to
`main`, Release writes the same version, CHANGELOG section and changeset
removals onto `release/X.Y.Z` and refuses to tag unless the branch then
differs from the approved beta tag only in `package.json`,
`package-lock.json`, `emdash-plugin.jsonc`, `CHANGELOG.md` and
`.changeset/*.md`, with those three JSON files changing only the version. It
then tags `vX.Y.Z` on the branch. The tag's run checks the same thing again,
creates the GitHub Release from `CHANGELOG.md`, and calls
`emdash-release.yml` with `release_mode: stable` to build, attest and publish
the bundle when the Registry lacks `dinkus-commerce@X.Y.Z`, and verify the
Registry record against it either way.

Never hand-push a tag and never publish by hand. If a merge run stops after
committing onto the branch but before the tag, re-run it: it resumes from that
commit. If a tag run fails, re-run that tag run, or press **Run workflow** with
**Use workflow from** set to the tag and `action: retry-publish`: it creates a
missing GitHub Release, publishes when the Registry still lacks the version,
and verifies the record again when it is already listed.

## A bug in a released version

Merge the fix to `main`, then press **Run workflow** with `action: add-fix`,
`release_version` set to the next patch (`X.Y.(Z+1)`) and `fix_commit` set to
the fix's merge commit. With no `release/X.Y.(Z+1)` yet, it makes that patch
branch from the `vX.Y.Z` tag, copies the fix and tags `X.Y.(Z+1)-beta.1`.
Journeys, then Promote and the release PR as above. A patch branch takes only
patch changesets; Promote refuses one whose changesets make a minor release.
Patch branches work for versions released through release branches (after
0.4.0); a fix for 0.4.0 itself ships in the next release from `main`.

## Bundle preparation

The Registry job first runs the normal Commerce build.
`scripts/prepare-emdash-release.mjs` copies its prebundled source into a
temporary standalone directory and invokes the official `release prepare`
command there, which avoids rebuilding the raw dependency closure or
discovering generated test packages in the checkout. For a beta it rewrites
only the manifest slug and display name (`scripts/beta-release.mjs`), so beta
code and declared access are identical to the stable build; any other
slug/version pairing is refused. The Registry has no prerelease filter, which
is why betas publish under their own package.

## Publish signal (known upstream issue)

The delegated release service currently ends successful publishes in
`RELEASE_CONFLICT` ([emdash#4159](https://github.com/emdash-cms/emdash/issues/4159)):
the intent writes the release record, then reconciliation judges that
same record a conflict. The publish job therefore does not trust the
intent outcome. After the publish step, `verify-registry-release.mjs`
reads the publisher PDS record directly and passes the job only when
that record carries exactly the bundle bytes prepared in the same run
(version, package checksum, and blob size). A green publish job means
the Registry holds this run's bytes; a red one means it does not,
whatever the intent reported. Remove the `continue-on-error` gate swap
once the upstream issue is fixed.

## Owner setup

Done for both listings: the release GitHub App (`RELEASE_APP_ID`,
`RELEASE_APP_PRIVATE_KEY`), the `dinkus-commerce` and `dinkus-commerce-beta`
package profiles authorized in the
[release-service dashboard](https://releases.emdashcms.com/publisher), the
`release.yml` workflow connection, and the `DINKUS_LIVE_JOURNEYS_TOKEN` org secret (above).

Needed once for release branches:

- The workflow connection was approved for runs on `refs/heads/main`. Publishes
  now run from version tags, so the first tag run's publish step waits for a
  new **Connect repository** request on the dashboard. Approve it for version
  tags (`refs/tags/*`).
- A repository ruleset on `release/*` branches and `v*` tags that lets only
  the release GitHub App push, create or delete them.
Registry publishing uses GitHub OIDC, so no Atmosphere credential is stored
here. If the dashboard ever asks to approve the workflow connection again, it
shows the request only while a run's publish step waits for it, for up to 30
minutes. If that time runs out, press **Run workflow** with **Use workflow
from** set to the version tag and `action: retry-publish`. Don't re-run the
old run: a re-run reuses its expired request and fails with
`WORKFLOW_CONNECTION_CONFLICT`.

## 1.0.0 gate

`check-no-major.mjs`, the changeset check, and `scripts/repo-contract.mjs`
all hold Commerce on 0.x. Removing those guards is the explicit 1.0.0
decision (coupons, inventory, commerce, payments, and ship landed).
