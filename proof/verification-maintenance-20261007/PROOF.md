# Verification maintenance proof — 2026-10-07

Repository: `dinkuskit/commerce`. Base: `f170e201ad4ccb96a7f8b2b20859b4e75a239d56`.
Branch: `codex/verification-maintenance-20261007`.
Isolated worktree: `commerce-verification-20261007` alongside the main checkout.

Added the canonical local verification skill and README link. The shell gate
resolves its own root and recursive full invocation and reports success only
when the chosen scope finishes.

## Red and green

Two full runs failed because a local D1 contender returned Wrangler's opaque
internal-error reference instead of the named SQLite unique constraint.
Serial integration files also failed, so serializing the suite was rejected.
The focused D1 suite passed once unchanged, confirming the intermittent symptom.

The local contender helper now retries the exact opaque diagnostic, like its
existing SQLITE_BUSY retry, up to five attempts. It replays the identical
idempotent fixture INSERT/UPSERT and identity. No product retry behavior changed.
Constraint assertions were preserved: one writer succeeds, the loser reports
the declared named unique constraint, and exactly one record remains stored.
The fixed focused D1 suite passed all 3 race tests.

Final command: `../bin/verify-commerce full` from `docs/`, under Node 22.23.2
and npm 10. Exit 0; `verify-commerce: full passed`.

- Unit/workflow tests: 301 passed.
- Integration tests: 37 passed.
- Sandbox/native browser gate: 5 passed.
- Native local-stock browser profile and installed-coupon profile passed.
- Typechecking, sandbox bundle validation and repository/feature audits passed.

Raw red/green output is retained locally under ignored
`.grilltrack/work/verification-maintenance-20261007/`.
Relative invocation and child failure propagation were smoke-tested using a
temporary npm stub: commands used the owned repo root, child exit 23 was
preserved, and no success message appeared on failure. Invalid modes exit 64.
`git diff --check` passed.

Accepted: stale/missing skill documentation, cwd-dependent shell gates, and
bounded local D1 diagnostic recovery. Rejected: relaxing constraints,
serializing integration files as a fix, or claiming live processor/production
readiness from synthetic local tests. No product decision or ledger changed.
