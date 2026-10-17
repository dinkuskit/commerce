# Releasing Commerce

The authoritative plan lives in
[`dinkuskit/dinkuskit` `docs/plans/release-process.md`](https://github.com/dinkuskit/dinkuskit/blob/main/docs/plans/release-process.md)
(GrillTrack decisions `release-changesets-061` through
`release-releasing-md-070`). This file is the per-repo operating summary.

## Day to day

1. Every pull request adds a changeset: `npm run changeset` for shipped
   behavior, `npx changeset --empty` for docs, tests, or CI only.
   On 0.x, bug fixes are `patch` and everything else is `minor`. CI
   (`changeset-check.yml`) rejects a missing changeset and any `major`
   bump.
2. Merging to `main` makes the release bot open or update the
   `ci: release` pull request. It bumps `package.json`, syncs
   `emdash-plugin.jsonc`, and writes `CHANGELOG.md`.
3. Review the release PR like any other (ClawSweeper exact-head gate
   applies). **Merging it is the publish yes**: the publish job creates
   the `vX.Y.Z` tag and the GitHub Release, then
   `.github/workflows/emdash-release.yml` publishes the same version to
   the EmDash Registry through the delegated release service.
4. Never hand-push a tag and never publish by hand. If tagging succeeded but
   Registry publication failed, run the Release workflow on `main` with
   **publish-only** checked after the necessary source repair is reviewed.
   Recovery requires the existing version tag to be an ancestor of the actual
   workflow source, with matching package/plugin metadata and unchanged runtime
   and build inputs. It skips tag/release creation and uses a separate Registry
   recovery signal, so an existing tag cannot silently suppress the retry.

The supported Registry-only recovery command is:

```sh
gh workflow run release.yml --repo dinkuskit/commerce --ref main -f publish-only=true
```

Recovery builds from the actual `main` revision selected for that run. Its
provenance identifies that source commit and workflow invocation; the existing
version tag remains at its original commit. Before dispatching recovery, confirm
that the current version, beta profile and permissions still match the approved
release. Verify the actual run's prepared archive, provenance and Registry record
rather than reusing a local preparation digest or treating an existing tag as
proof that Registry publication succeeded.

## One-time setup still required (owner)

- Create the dedicated release GitHub App (separate from the
  smoky-agent builder bot) with Contents and Pull requests write, and
  store its credentials as the `RELEASE_APP_ID` and
  `RELEASE_APP_PRIVATE_KEY` repository secrets.
- In the [release-service dashboard](https://releases.emdashcms.com/publisher),
  choose **Authorize publishing** for the package profile, then approve
  this repository workflow connection on its first run.
- Create the baseline `v0.2.0` tag for the already-published Registry
  version (the one deliberate exception to "never hand-push a tag").

Registry publishing uses GitHub OIDC and the delegated release service,
so no Atmosphere credential is stored in this repository. Approvals are
only requested when a release expands plugin permissions.

The Registry job first runs the normal Commerce build. The preparation helper
copies its prebundled source into a temporary standalone directory and invokes
the official `release prepare` command there. This avoids rebuilding the raw
dependency closure or discovering generated test packages in the checkout.
The helper preserves the official publisher and version outputs and copies
the resulting archive back to `.emdash-release` for provenance and publication.

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

## Beta status

The locked beta flow publishes `x.y.z-beta.N` under the separate
`dinkus-commerce-beta` package: the Registry has no prerelease
filter, so a beta under the real slug would become the latest version
for every install. The Registry workflow routes prerelease selectors
to the beta slug, and the prepare helper stages the same audited
prebundle with only the manifest slug and display name rewritten, so
beta code and declared access are identical to the stable build.
Any other slug/version pairing is refused.

Cutting a beta is manual until demo-store e2e automation lands:

1. Open a PR that runs `npx changeset pre enter beta` (commits
   `.changeset/pre.json`) with an empty changeset, and merge it.
2. Merge normal feature PRs with changesets; the release bot's
   `ci: release` PR now proposes `x.y.z-beta.N` versions.
3. Merging that release PR tags `vX.Y.Z-beta.N` and publishes to
   `dinkus-commerce-beta` only. Install the beta on the demo store
   and validate there with the live test (below).
4. Open a PR that runs `npx changeset pre exit` and merge it; the
   next `ci: release` PR proposes the final version for the stable
   package.

Remaining owner setup before the first beta publish: create the
`dinkus-commerce-beta` package profile (`emdash-plugin profile
setup` against a staged beta manifest), authorize publishing for it
in the release dashboard, and approve its workflow connection on the
first beta publish run. `proof/registry-beta-publishing-20261014/`
carries a ready-to-run prompt for that setup.

## Live test

The live test is the e2e run that validates a release on a store: the
[`dinkuskit-live-test`](https://github.com/saariuslystoned/SaariusSkills/tree/main/skills/dinkuskit-live-test)
skill in SaariusSkills. On a store running the release, it places a Stripe
TEST order, makes a Pitney Bowes sandbox label in Ship, waits for Commerce's
5-minute background check to collect the label, and checks that Commerce marks
the order Completed. Its `PROOF.md` names the plugin versions the store ran, so
a pass says which release it covers.

It runs only on a machine set up for it (the skill's `references/setup.md`)
and pays only with Stripe's test card. Hand back its verdict and the plugin
versions it lists with the release.

## 1.0.0 gate

`check-no-major.mjs`, the changeset check, and `scripts/repo-contract.mjs`
all hold Commerce on 0.x. Removing those guards is the explicit 1.0.0
decision (coupons, inventory, commerce, payments, and ship landed).

Both preparation and published-record verification consume the effective
routed selector. A prerelease is checked against its beta package record,
never a same-version record under the stable slug. Stable releases retain
the stable package identity and the same checksum, size, and MIME gate.
