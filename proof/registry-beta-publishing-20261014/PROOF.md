# Proof: beta Registry publishing routing (commerce)

Loose end 2 from the release-process rollout: beta publishing was
fail-closed pending a separate beta package (locked decision
`release-beta-flow-066` in dinkuskit/dinkuskit).

- Repository: `dinkuskit/commerce`
- Worktree: `~/Developer/worktrees/dinkuskit-commerce-beta-20261014`
- Branch: `codex/registry-beta-publishing-20261014`
- Base: `origin/main` at `29f55b0857dc4545de70a02f6b549135951ce4b8` (0.2.2)

## Change

- `scripts/beta-release.mjs`: pure routing helpers —
  `effectiveSelector` (stable versions keep the real slug,
  prereleases route to `<slug>-beta`, beta slug with a stable
  version is invalid) and `betaManifest` (stable manifest with only
  `slug` and display `name` rewritten).
- `emdash-release.yml`: the prerelease refusal step becomes a
  routing step that computes the effective selector; the prepare
  helper is the enforcement point and refuses any slug/version
  pairing other than stable-slug/stable-version or
  beta-slug/prerelease-version, so a beta can never publish under
  the stable slug even if routing is bypassed.
- `scripts/prepare-emdash-release.mjs`: stages the same audited
  prebundle; for beta selectors it writes the beta manifest into the
  standalone prepare directory and validates prepare output against
  the beta slug and `dinkus-commerce-beta-<version>.tar.gz`.
- `RELEASING.md`: beta flow is now the manual Changesets pre-mode
  sequence; demo-store e2e automation and the automatic pre-mode
  exit remain future work tied to the E2E program.
- Empty changeset: workflow/build only until the first beta is cut.

## Commands and results

- Stable path unchanged: `node scripts/prepare-emdash-release.mjs
  "dinkus-commerce@0.2.2"` prepared
  `dinkus-commerce-0.2.2.tar.gz` after a clean
  `registry_bundle=pass backend_bytes=114432`.
- Refusals: `dinkus-commerce-beta@0.2.2` (beta slug, stable version)
  and, after a simulated 0.3.0-beta.1 bump,
  `dinkus-commerce@0.3.0-beta.1` (stable slug, prerelease) both throw
  the pairing error.
- Simulated prerelease (temporary local bump to 0.3.0-beta.1,
  reverted before commit): `npm run build` passes the Registry
  bundle gate, beta prepare produces
  `dinkus-commerce-beta-0.3.0-beta.1.tar.gz` whose manifest reads
  `id: dinkus-commerce-beta`, version `0.3.0-beta.1`, identical
  declared access, and backend 114,432 bytes — same code as stable.
- Unit tests cover selector routing and manifest rewriting; full
  gates (`npm test`, `audit:repo`, `typecheck`) run on the final
  head and are recorded in the PR.

## Human gates honored

No beta profile was created, nothing was published or dispatched,
and no version was bumped in the committed tree. Before the first
beta publish, the owner creates and authorizes the
`dinkus-commerce-beta` profile (ready-to-run prompt in
`BETA-PROFILE-PROMPT.md` beside this proof) and approves its
workflow connection on the first beta run. Cutting a beta (pre-mode
enter/exit PRs and merging a beta `ci: release`) remains separately
approved maintainer work.
