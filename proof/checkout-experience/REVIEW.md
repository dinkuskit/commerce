# Checkout candidate review

Scope: local Commerce checkout orchestration candidate on
`codex/checkout-experience`, base `51ab023b14490e3bff821e5310dd1c323092df30`.
The immutable candidate identity is the SHA-256 of `source-manifest.sha256`.
This is a local standards/source-intent inspection, not an official
ClawSweeper verdict or release acceptance.

## Adjudication

- `required_fix`, repaired: payment account/provider selection must not follow
  current configuration on retry. Requests now freeze an immutable binding ref;
  missing old adapters retain uncertainty. Verified by the binding-change test.
- `required_fix`, repaired: a contradictory `not-created` result could release
  a known session. It now fails closed and retains holds. Regression test added.
- `reject_false_positive`: a local 30-minute timer should release stock. The
  accepted lock explicitly requires confirmed non-payment, and tests show a
  local deadline merely suppresses a redirect.
- `reject_false_positive`: persist order and receipt into separate collections.
  A single CAS aggregate atomically stores terminal paid state and the stable
  Commerce order/receipt identities. A separate writer would introduce another
  recovery boundary without an accepted requirement.
- `defer`: registry routes/collection mounting. The separately owned registry
  continuity lane must integrate the exported service and `checkoutCarts`.
- `defer`: real Inventory reservation/release and Payments Stripe transport.
  Their required durable idempotency and mutually exclusive terminal outcomes
  are explicit contracts, with synthetic behavior proof only. In particular,
  a raw expired/unpaid snapshot must not be normalized as terminal if settlement
  remains possible. No real Stripe or hosted Inventory proof is claimed.
- `human_gate`: formal review is pending. The initial local handoff preceded
  commit/push/PR authorization; publication as a draft PR is now explicitly
  authorized while review rails are repaired. Repository `docs/REVIEW_RAIL.md`
  requires maintainer-triggered ClawSweeper for formal acceptance. No official
  review generation was dispatched and no official clean claim is made.
  Merge and deployment remain outside the authorization.

Standards inspection: public feature entry points used; existing Money remains
USD integer minor-unit strings; no stock ledger, credentials, private history,
storefront redesign or registry migration added. All changes are in the
assigned checkout worktree. Sustained state stays under ignored GrillTrack
work; curated public proof stays here.

Source-intent inspection: no mandatory shopper account; authoritative catalog
price/sellability; complete managed basket before payment; fixed first-created
payment window; paid holds retained; confirmed non-payment release; fresh
attempt after completed release revalidates; unknown and partial operations
recover using the same identities. Fulfillment, real stores, shipping, taxes,
merchant onboarding and delayed-payment methods remain outside this patch.
