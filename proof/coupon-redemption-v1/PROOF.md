# Coupons v1 current verification

This proof is for the current repaired working tree. It does not claim an
independent clean review; parent/official review remains pending. No commit,
push, PR, checkout/runtime mount, payment integration, order writer, or UI
adoption is included.

## Lineage and parent finding adjudication

- Following parent review findings on minimum spend policy, the required fix
  was implemented and verified through the GrillTrack ledger CLI.
- Adjudication records `findings` / `required_fix` followed by bounded
  `implement` and `verify`. No independent clean claim is made; parent/official
  review remains pending.

## Current implementation

- One admin-created `coupons` record/CAS authority for admin, evaluator,
  attempts, reconciliation, and counts.
- Evaluator fails closed (`CouponAdminError` `INVALID_INPUT` with message
  `minimum eligible merchandise spend not met`) when eligible merchandise
  spend is below the rule minimum; minimum failure is ineligible, not an
  accepted zero-discount quote.
- `createCouponAttemptOwner.reserve` validates current rule minimum against the
  frozen quote `eligibleSubtotal` before new CAS, rejecting stale/forged
  quotes without consuming cap capacity. Replay of existing identical attempts
  remains first and unaffected by subsequent minimum edits.
- Zero final-payable free policy remains intact: coupons with qualifying
  subtotals that reduce payable total to zero reconcile through the trusted
  free-order seam.
- Immutable attempt snapshots cover rule version, identities, priced lines,
  allocations, discount, merchandise totals, and the trusted host final total.
- Existing attempts are resolved before current rule/date/disabled checks.
- Cap edits preserve history and counts; released holds cannot be resurrected.
- Free completion requires strict trusted zero-overall-payable Commerce proof
  tied to the original attempt and canonical order/receipt identity.
- Offset-only, calendar-valid dates use epoch comparison; code lookup is
  normalized and paginated.
- Complete internal arithmetic validation on quotes and stored attempt records.
- Comprehensive acceptance tests covering independent connections,
  concurrent free proof race, retry snapshot preservation, cap CAS, unique index
  collision, corruption fail-closed, and evaluator rounding/largest remainder.
- Browser/admin, checkout, payment, order, and shopper host seams remain
  unmounted/pending.

## Verification commands

The former AGY7cfcdce3 job used Node 22.23.2 through `mise exec`; its raw logs
may not be present in the current checkout. Local state records the
minimum-spend findings from that partial handoff, but does not guarantee that
the supporting logs remain available.

- `npm run build`
- `npm run typecheck`
- `node --test tests/features/coupons/*.test.mjs`
- `npm run audit:repo`
- `npm run test:unit`

This proof is not a claim of a completed AGY7cfcdce3 run: that job timed out
after a partial handoff. It does not claim checkout/runtime mounting, payment
integration, order writing, or UI adoption.

Former-job results retained for context: focused coupon tests 15 passed / 0
failed; full unit suite 230 passed / 0 failed; `npm run build`, `npm run
typecheck`, and `npm run audit:repo` passed. These figures are not newly
verified here. No commit, push, PR, dependency, configuration, checkout,
runtime, or package-root source change was made for this handoff.
