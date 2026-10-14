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
4. Never hand-push a tag and never publish by hand. If a publish step
   fails, re-run the Release workflow with **publish-only** checked.

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
   and validate there.
4. Open a PR that runs `npx changeset pre exit` and merge it; the
   next `ci: release` PR proposes the final version for the stable
   package.

Remaining owner setup before the first beta publish: create the
`dinkus-commerce-beta` package profile (`emdash-plugin profile
setup` against a staged beta manifest), authorize publishing for it
in the release dashboard, and approve its workflow connection on the
first beta publish run. `proof/registry-beta-publishing-20261014/`
carries a ready-to-run prompt for that setup.

## 1.0.0 gate

`check-no-major.mjs`, the changeset check, and `scripts/repo-contract.mjs`
all hold Commerce on 0.x. Removing those guards is the explicit 1.0.0
decision (coupons, inventory, commerce, payments, and ship landed).
