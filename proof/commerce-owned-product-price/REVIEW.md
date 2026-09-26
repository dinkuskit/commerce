# Exact-source review: commerce-owned product price

## Axes

- **Standards:** repository AGENTS.md, FEATURE_MAP, catalog isolation pattern,
  EmDash 0.40.1 plugin storage, `bin/verify-commerce`.
- **Source intent:** confirmed summary for track `gt-20260925212117-b02bdf`.

## Findings

None. Classified clean.

Isolated `catalogPrices` matches backorder/manual-availability isolation.
Money is USD integer minor strings. Guards match the locked Sale/Regular
rules, including refuse-not-Woo-silent-clear. Storefront `listable` is
additive. Unpriced products skip Inventory. `$0` remains listable. No
admin UI, checkout, Inventory transport, coupons, or template-store catch-up
landed.

`bin/verify-commerce full` passed: 98 unit, 19 integration (pre-price upgrade
case included), audits clean.

ClawSweeper later asked to keep unpriced products listable during rollout.
That contradicts locked `price-missing-002` / `price-clear-regular-007`.
Immediate de-listing is the shop-owner contract. Live reopen proof shows the
catalog row survives and `listable` is false until Regular is set.
