# Releasing Commerce

The authoritative plan lives in
[`dinkuskit/dinkuskit` `docs/plans/release-process.md`](https://github.com/dinkuskit/dinkuskit/blob/main/docs/plans/release-process.md)
(GrillTrack decisions `release-changesets-061` through
`release-beta-cut-071`). This file is the per-repo operating summary.

Commerce runs the same release files as `dinkuskit/payments`, with only
Commerce's names and its own bundle preparation: `scripts/release-flow.mjs`,
`scripts/release-authority-proof.mjs`, `.github/scripts/emdash-dispatch-gate.mjs`,
`.github/workflows/release.yml` and `.github/workflows/emdash-release.yml`.

| Channel | Registry package | Installed plugin ID | Version |
| --- | --- | --- | --- |
| Beta | `dinkus-commerce-beta` | `r_fjzjvld3ssb4j63o` | `X.Y.Z-beta.N` |
| Stable | `dinkus-commerce` | `r_gshdrqaldna3r7sn` | `X.Y.Z` |

Both buttons are on **Release** (`release.yml`): **Run workflow** with
`action: cut-beta` or `action: promote`. `emdash-release.yml` has no button of
its own; only `release.yml` calls it, so the release service connects both
listings through `release.yml`. The flow's baseline is `v0.3.0`, the last
release from the old Changesets-bot flow.

## Every pull request adds a changeset

`npm run changeset` for shipped behavior, `npx changeset --empty` for docs,
tests, or CI only. On 0.x, bug fixes are `patch` and everything else is
`minor`. CI (`changeset-check.yml`) rejects a missing changeset and any
`major` bump. Merging to `main` publishes nothing and opens no release PR.

## 1. Cut beta

When `main` has pending version-bumping changesets, press **Run workflow** on
**Release** on `main` with `action: cut-beta`. Leave `beta_version` blank for
the next `X.Y.Z-beta.N`, or give one.

- `X.Y.Z` is the version the pending changesets would release; `N` is one more
  than the highest `vX.Y.Z-beta.*` tag or `dinkus-commerce-beta` record on the
  publisher's PDS (every page, fail-closed on lookup errors).
- The dispatch gate (`emdash-dispatch-gate.mjs`) allows only `refs/heads/main`,
  `release_mode: beta` and `-beta.N` versions, before any token or Registry I/O.
- The workflow runs the unit tests and typecheck, stamps the beta version into
  the runner's `package.json` and `emdash-plugin.jsonc` (never committed),
  builds the prebundle, tags the `main` commit `vX.Y.Z-beta.N` with the release
  GitHub App, and publishes `dinkus-commerce-beta@X.Y.Z-beta.N`.

## 2. The beta-store journeys run themselves

Once the beta is published, Release's **Start the live journeys on the beta
store** job presses **Live journeys** in
[SaariusSkills](https://github.com/saariuslystoned/SaariusSkills/actions/workflows/live-journeys.yml)
with `beta: dinkus-commerce-beta X.Y.Z-beta.N`. That run waits for the
Registry to offer the beta, updates the beta store (beta.sm0ky.dev) to it, and
runs the `@running` journeys. It is named `Live journeys for
dinkus-commerce-beta X.Y.Z-beta.N`, and its page shows each journey's pass or
fail and the plugin versions tested. If an update asks for new permissions the
run stops and says what was asked; update the plugin by hand on the store's
Plugins page, then press Run workflow there again with the same `beta`.

The press needs the `LIVE_JOURNEYS_TOKEN` repository secret: a fine-grained
GitHub token whose only access is **Actions: Read and write** on
`saariuslystoned/SaariusSkills` (the same token Payments uses). Without it the
job fails after the publish, and the journeys can be started by hand with the
same `beta` input.

## 3. Promote

When that run passes, press **Run workflow** on **Release** with
`action: promote`, `beta_version: X.Y.Z-beta.N`, and `proof_ref` set to the
run's address followed by the beta version, for example
`https://github.com/saariuslystoned/SaariusSkills/actions/runs/<run id> (X.Y.Z-beta.N @running pass)`.
The address alone has no version in it, and the gate refuses a proof that
doesn't name the beta.

The gate checks that `vX.Y.Z-beta.N` points at the current `main` HEAD (if
`main` moved, cut and verify the next beta first) and that the Registry holds
the beta. Then `npm run release:version` (`changeset version`, the
`emdash-plugin.jsonc` version sync, and a lockfile-only install) opens or
updates the one `ci: release vX.Y.Z` PR from `changeset-release/main`, with a
`Release-Beta-Proof:` trailer naming the beta, its commit and the proof.

## 4. Merge the release PR

Comment `@clawsweeper review` on the release PR; only the reviewed commit
merges, and the owner's merge is the stable publish yes. On that push to
`main`, Release:

- refuses to tag unless the tree differs from the approved beta tag only in
  `package.json`, `package-lock.json`, `emdash-plugin.jsonc`, `CHANGELOG.md`
  and `.changeset/*.md`, and those three JSON files changed only the version;
- tags `vX.Y.Z`, creates the GitHub Release from `CHANGELOG.md`, and, when the
  Registry lacks `dinkus-commerce@X.Y.Z`, calls `emdash-release.yml` with
  `release_mode: stable` to build, prepare, attest, publish and verify it.

Never hand-push a tag and never publish by hand. If a stable run fails after
tagging, re-run the failed Release run: it finds the tag on that commit,
creates a missing GitHub Release, and publishes when the Registry still lacks
the version. A fix that needs new source ships as the next version through
Cut beta and Promote.

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
[release-service dashboard](https://releases.emdashcms.com/publisher), and the
`release.yml` workflow connection. Registry publishing uses GitHub OIDC, so no
Atmosphere credential is stored here. Still to add before the first Cut beta
press can start the journeys: the `LIVE_JOURNEYS_TOKEN` secret (above).

## 1.0.0 gate

`check-no-major.mjs`, the changeset check, and `scripts/repo-contract.mjs`
all hold Commerce on 0.x. Removing those guards is the explicit 1.0.0
decision (coupons, inventory, commerce, payments, and ship landed).
