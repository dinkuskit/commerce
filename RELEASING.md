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

The locked beta flow publishes `x.y.z-beta.N` under a separate beta
plugin name on the demo store. That wiring has **not** landed yet, so
the Registry workflow refuses prerelease versions instead of publishing
a beta under the real slug (the Registry has no prerelease filter, and a
beta would become the latest version for every install). Until the beta
package lands, validate release candidates from the GitHub prerelease
instead.

## 1.0.0 gate

`check-no-major.mjs`, the changeset check, and `scripts/repo-contract.mjs`
all hold Commerce on 0.x. Removing those guards is the explicit 1.0.0
decision (coupons, inventory, commerce, payments, and ship landed).
