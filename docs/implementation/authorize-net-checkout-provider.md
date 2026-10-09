# Authorize.net installed checkout provider

GrillTrack status:

- `checkout-authorize-net-provider-20261008` — **locked**
- `checkout-authorize-net-provider-ryan-notes-20261008` (#71 answers) — **locked**
- `checkout-authorize-net-provider-ryan-notes-20261008b` (#72 answers) — still **proposed**

Locked by Ryan, 2026-10-08 3:07 PM ET, confirmed 3:20 PM ET.
Cite: https://github.com/dinkuskit/commerce/pull/71#issuecomment-6067094917

The lock covers these decisions only. It does **not** approve merging #71 or #72.

Context: Payments exposes an `authorize_net` adapter and sandbox Accept Hosted
wiring ([payments PR #22](https://github.com/dinkuskit/payments/pull/22) at
`c1ae709b`). Commerce [#67](https://github.com/dinkuskit/commerce/pull/67)
freezes chosen variant IDs, labels, price, and fulfillment before Payments
contact. Charge and paid amount checks must use that frozen total — never a
recomputed price.

## Locked terms

1. Keep `dinkuskit.commerce.registry-checkout/v1`. Older saved configs without
   the new fields must keep loading, with a test proving an old saved config.
2. Authorize.net merchant identity uses optional **`authorizeNetMerchantId`**
   only. `stripeAccountId` stays Stripe-only. The `authorize_net` sentinel and
   any cross-provider field fail closed.
3. Sandbox only. No live endpoints, live credentials, or live-mode toggle until
   Ryan approves live.
4. An order is marked paid only by an authoritative transaction lookup whose
   amount and currency match. A signed webhook alone never marks paid.

## Compiled backend size

Measured on the compiled `dist/sandbox/plugin.mjs` (not source):

- Main after #75 (coupons deferred from Registry): **102045** bytes
- This branch (authorize_net + retained kernel factoring on post-#75 main):
  re-measure on each push; must stay under **131072**
- Splitting source only helps when unused code actually leaves this compiled
  bundle (Ryan #68). Follow #75’s coupon-port layout; keep only factoring that
  still drops compiled bytes.

## Product rules

1. `providerId` may be `stripe` or `authorize_net`.
2. Optional `authorizeNetMerchantId` only with `authorize_net`.
3. Optional `mode`, when present, must be `test`.
4. Paid requires authoritative Payments lookup matching the frozen attempt
   total and currency; webhook/return/token/timer never write paid.
5. Backend under 131072 bytes with meaningful headroom via cohesive factoring
   that actually leaves the compiled sandbox bundle.

## Non-goals

No secrets, live traffic, merge, or agent-initiated GrillTrack lock beyond
Ryan’s explicit maintainer lock.
