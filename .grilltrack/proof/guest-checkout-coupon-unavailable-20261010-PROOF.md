# Guest checkout coupon failures proof (issues 34 and 32)

Decision: `guest-checkout-coupon-unavailable-034`, locked by the project owner
on 2026-10-10. Base: `240acd5` (main).

## Issue 34

- A coupon quote whose arithmetic disagrees with Commerce's own prices (line
  total not price times quantity, discount above its line, totals that do not
  add up) is refused before any attempt is written, coupon held or payment
  started.
- A coupon that is unknown, no longer applies, cannot be reached or is not
  configured answers `COUPON_UNAVAILABLE`; checkout without a coupon still
  works on the same capability.
- A refused hold releases the attempt with `coupon.refused`, and its guest
  projection carries `COUPON_UNAVAILABLE`. Asking again with the same coupon is
  refused again; only starting without the coupon charges the full 1000.

Neutral fixtures: a 1000-minor-unit item with a 250 accepted discount, in
`tests/features/checkout/registry-coupons.test.mjs`; compiled Registry backend
under workerd in `tests/integration/registry-checkout-services.test.mjs`.

## Issue 32

Every acceptance and proof item already has a test on main: capability
retention and restart, cross-cart and cross-site denial, price and field
tampering, forged success and out-of-order wakes, one durable paid order,
unmanaged baskets without Inventory, managed baskets fail closed
(`tests/features/checkout/guest-mount.test.mjs`,
`tests/integration/guest-checkout-dispatch.test.mjs`,
`tests/integration/registry-checkout-services.test.mjs`,
`tests/sandbox/guest-checkout.spec.mjs`). The public contract is
`docs/implementation/guest-checkout-public.md`.

## Verification

Node 22.23.2, `bin/verify-commerce full` on this source: PASS.

- `npm run test:unit`: 472 pass, 0 fail.
- `npm run test:integration`: 45 pass, 0 fail.
- `npm run test:sandbox`: 10 pass; `:native-local-stock` 1 pass; `:orders` 1 pass.

Registry backend `dist/sandbox/plugin.mjs`: 117,441 bytes, 13,631 under the
131,072 limit (main 117,068; +373). SHA-256
`edf3006b1b8b85f080c5619166e1240abd36d02bf86aa1ab104affc92511687f`.
