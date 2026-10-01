# Coupons v1 current verification

This proof covers the source repaired after the first two review rounds of Commerce
PR #40. Parent adjudication accepted the P1 and P2 fixes; fresh exact-commit
official review remains pending. Checkout/runtime mounts, payment integration,
order creation, and merchant/shopper UI adoption remain pending.

## Lineage and parent finding adjudication

- The historical parent/native review of `git:b4dbe7adb2e7f29edcfd6c50b460c38b1a0cf835`
  accepted one P1 monotonic-rule finding and one P2 nullable-attempt-get finding.
- The existing P1 fix remains present and is covered by the monotonic-version
  regression. The P2 fix makes `get` nullable for absent coupons and attempts,
  while preserving validation, corruption fail-closed behavior, and frozen
  returned attempts.
- Adjudication records `findings` / `required_fix` followed by bounded
  `implement` and `verify` for the affected redemption decisions. No
  worker independent clean claim is made; parent accepted the repaired source
  for fresh official review.

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
- Attempt lookup returns `null` for a missing coupon or valid coupon with no
  matching attempt; stored corruption still returns `CORRUPTED_RECORD`, and
  returned attempts are deep-frozen clones.
- Comprehensive acceptance tests covering independent connections,
  concurrent free proof race, retry snapshot preservation, cap CAS, unique index
  collision, corruption fail-closed, and evaluator rounding/largest remainder.
- Browser/admin, checkout, payment, order, and shopper host seams remain
  unmounted/pending.

## Verification commands

Using Node 22.23.2 through `mise exec`, the current working tree passed:

- `npm run build`
- `npm run typecheck`
- `node --test tests/features/coupons/*.test.mjs`: 18 passed / 0 failed
- `npm run audit:repo`
- `npm run test:unit`: 233 passed / 0 failed

Raw outputs are retained under
`.grilltrack/work/coupon-redemption-run/*-free-reconcile.log`. This verification
does not claim checkout/runtime mounting, a complete purchase flow, provider
mutation, deployment, or merge approval.

## Second Spark review finding

The comprehensive P3 review of `git:54eb36d9824842aec6a7f80c4cb38ecabf80a84a` found a P2: free failed/cancelled reconciliation could persist a provider session and violate the durable record validator. Accepted and repaired through Cursor Luna Medium ACP. The real SQLite regression failed before the fix; rejection now runs before unknown/terminal replay checks and preserves pending, consumed and released records, counts and revisions. A fresh connection can read and edit the coupon afterward. Sessionless release and durable free consumption remain valid. Fresh exact-commit reviews and CI remain pending.
