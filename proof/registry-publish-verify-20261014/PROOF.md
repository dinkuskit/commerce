# Proof: truthful Registry publish signal (commerce)

Handles loose end 1 from the release-process rollout: delegated
publishes landed on the Registry while their workflow jobs failed.

- Repository: `dinkuskit/commerce`
- Worktree: `~/Developer/worktrees/dinkuskit-commerce-publish-verify-20261014`
- Branch: `codex/registry-publish-verify-20261014`
- Base: `origin/main` at `29f55b0857dc4545de70a02f6b549135951ce4b8` (0.2.2)
- Upstream report: https://github.com/emdash-cms/emdash/issues/4159

## Diagnosis

Both delegated publishes (0.2.1 intent `01M4W5T4BNG9RHKX5HAAYX13MK`,
0.2.2 intent `01M4W7P2T38WWVHMBTJBS6QJ9N`) followed the same arc in a
single run attempt with the default run-scoped idempotency key:
submitted, entered `publishing`, then entered `conflict` about eleven
seconds later with `RELEASE_CONFLICT: A different release already
exists for this package version`. In both cases the release record
exists on the publisher PDS at the deterministic URI, carries the
workflow provenance extension, and is indexed by the Registry
(`latestVersion: 0.2.2`, listing passed). The records round-trip the
service's own reconciliation comparison locally (lexicon `safeParse`
in default and strict mode, then its canonical JSON: byte-identical),
so the mismatch is between the service's persisted materialized record
and its proof-verified read — service-side, not a workflow input
error. No upstream fix exists yet (no release-path commits since the
pinned action ref `06f911b`).

## Change

- `.github/scripts/verify-registry-release.mjs`: resolves the
  publisher PDS from the DID document, polls
  `com.atproto.repo.getRecord` for the selector version, and passes
  only when the record's package checksum (multihash of the prepared
  tarball bytes, computed with node:crypto only), blob size, and
  version match this run's bundle exactly. A record carrying
  different bytes fails immediately; absence fails after five
  minutes.
- `emdash-release.yml`: the publish step is `continue-on-error` (the
  only such step, pinned by test) and the verifier runs after it as
  the job gate, with a summary note when the intent failed but the
  Registry record verified. Nothing is masked: a genuine conflict
  (different bytes under the same version) still fails the job.
- `RELEASING.md`: documents the known issue and the gate swap to
  remove once upstream fixed it.
- Empty changeset: workflow/build only, shipped artifact unchanged.

## Commands and results

- `node .github/scripts/verify-registry-release.mjs
  did:plc:ekk4pjmkh3k3ql2kfoex3qt4 "dinkus-commerce@0.2.2"
  <0.2.2 tarball from the PDS blob>` —
  `registry_release_verified=... checksum=bciqj6fe…` exit 0.
- Same command with selector `dinkus-commerce@0.2.1` against the
  0.2.2 tarball — exit 1, `package checksum differs; package blob
  size differs`.
- `node --test tests/workflows/release-process.test.mjs
  tests/repo-contract.test.mjs` — 15 pass (3 new verifier tests:
  checksum vectors, exact-match oracle, gate wiring).
- `npm test` — 562 pass, 0 fail. `npm run audit:repo` — clean.
  `npm run typecheck` — clean. Workflow YAML parses.

## Human gates honored

No merge, publish, workflow dispatch, or secret change. The next
release after this merges is the first live exercise of the gate;
merging any future `ci: release` PR remains the publish approval.

## Review repair round 1

ClawSweeper reviewed `ece30ec` and raised one P2 finding: the
intent-outcome note ran on publish failure alone, so it could claim
a verified publish after the verifier itself failed. Adjudication:
`required_fix`. The verifier step now has an id and the note
requires `steps.verify.outcome == 'success'` as well; the workflow test
pins that invariant.
