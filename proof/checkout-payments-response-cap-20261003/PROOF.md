# Checkout Payments response cap

Bounded source repair on `codex/checkout-payments-response-cap-20261003`,
base `7a8d262441d14ea4ec5e824a1baa76b5a6f0049c`.

## Result

`src/features/checkout/test-payments.ts` now reads successful Payments
responses as byte streams with a 131072-byte cap before UTF-8 decoding and
`JSON.parse`. Overflow cancels the reader and releases its lock. Missing,
malformed, unreadable, and non-byte bodies fail closed. Existing request
cloning, binding/session checks, outcome handling, CAS, stock-release, and
wake acknowledgement rules are unchanged.

## Regression-first evidence

- `regression-before.txt`: baseline response parsing accepted oversized
  streams and reached later validation/session paths.
- `regression-after.txt`: five focused synthetic cap/reconciliation tests pass.
- Coverage includes all four binding/session/lookup endpoints, exact finite
  bound, split UTF-8, misleading `Content-Length`, cancellation and lock
  release, malformed body variants, and retained canonical reconciliation with
  no order, stock release, or acknowledgement.

## Verification

- `npm run typecheck`: exit 0.
- `npm run audit:repo`: exit 0; public repository and feature contracts clean.
- `npm run build:sandbox`: exit 0.
- Full `tests/features/checkout/*.test.mjs` was attempted. Native SQLite
  cases are blocked by the locally installed `better-sqlite3` macOS code
  signature/team-ID mismatch (`ERR_DLOPEN_FAILED`), unrelated to this repair.
- No provider calls, accounts, credentials, auth stores, environment files,
  Stripe, installed checkout, or real-payment proof were used.

Source hashes are recorded in `source-manifest.sha256`. This is synthetic
author proof only; no commit, push, PR, merge, deploy, publish, or registry
submission was performed.

## Parent acceptance

The initial worker SQLite binding failure was resolved by rebuilding that
worktree dependency under the local signed Node helper. Required local checks
now pass:255unit,22integration,5browser,and1local-stock check, plus typecheck,
repository/feature audits and official sandbox build. The first full command
hit an already occupied browser port; browser checks were rerun successfully
on task-specific ports without touching another process.

The parent compiled the exact baseline transport module from the supplied Git
object in an ignored diagnostic directory. The new finite-body regression
fails there with Missing expected rejection and passes on the repaired module.
finite-body-repro.json records1048697bytes parsed by baseline and subsequent
session dispatch; repaired code rejects before session dispatch. Earlier
regression text files are author summaries, not raw logs. Raw parent command
outputs/digests are recorded in PARENT-VERIFICATION.json.

SOURCE-REVIEW.json records separate parent source-intent review and adjudication
against the immutable two-file manifest identity. This is not Spark OpenClaw or
native ClawSweeper clearance. Draft PR native admission and current CI/review
evidence remain separate delivery checks; no merge or provider activation.
