# Authorized guest receipt identifies canonical numbered TEST and live orders

Issue: `dinkuskit/commerce#283`
Base: `origin/main` `c325fe49eb67f60d6759ef93e76386788d6bc99e`
Branch: `codex/guest-receipt-test-identity-283`

## Summary

- `PaidOrderStatus` (`src/handoffs/paid-order.ts`) and `createPaidOrderReceiver().status(orderId)` (`src/features/orders/store.ts`) now include `number: kept.number ?? null` and `test: kept.paidOrder?.mode !== "live"` via a read-only `collection.get(orderId)` lookup (never writing or incrementing `order_numbers`).
- `projectGuestCheckout` (`src/features/checkout/project.ts`) projects `test: attempt.order.mode !== "live"` onto `GuestCheckoutOrderSummary` from the paid order's own frozen mode (defaulting absent legacy `mode` to `true`, never inferring from current store settings, never exposing internal `mode`).
- `cartGuestCheckout` (`src/features/checkout/guest.ts`) merges `PaidOrderStatus` when Orders answers, exposing `checkout.order.number` (canonical short number when assigned, `null` before numbering) alongside `checkout.order.test`, `status`, and `completed`, while preserving the valid frozen receipt (`orderId`, `receiptId`, `total`, `contact`, `test`) when Orders is unbound, fails, or holds no copy.

## Registry bundle size (Node v24.22.1)

- `npm run build`: `registry_bundle=pass backend_bytes=130494 headroom_bytes=578 backend_sha256=2e28b1b362aa4016b1c09064c293851e498cc6f0184a378d18d522ba2ae1e802` (+55 bytes vs `origin/main` `130439`, 578 bytes spare under the 131,072-byte cap).

## Verification (`npm run verify:full`)

- `npm run typecheck`: pass
- `npm run test:unit`: 885/885 pass (includes `tests/features/checkout/server-cart.test.mjs` covering numbered TEST orders, numbered LIVE orders, settings flips after payment, historical missing-number fallback without renumbering or UUID digit parsing, absent/failing Orders reads, and missing/forged/other-shopper capability refusal, plus `tests/features/orders/identity.test.mjs` covering `PaidOrderReceiver.status`)
- `npm run audit:repo`: pass (`public_repository_contract=clean`, `feature_contract=clean`)
- `npm run test:integration`: 113/113 pass (real compiled `workerd` bundle + SQLite in `tests/integration/registry-checkout-services.test.mjs`, covering numbered TEST/LIVE orders, post-payment store-setting flips, unnumbered historical fallback without touching `order_numbers`, absent Orders copy fallback, and forged/foreign/other-shopper refusal)
- `npm run test:sandbox`: 12/12 pass
- `npm run test:sandbox:orders`: 5/5 pass
- `npm run test:consumer:package`: pass (`npm_package_consumer=pass declared-exports library-root cli-help`)
- `npm run test:settings`: 1/1 pass
- `verify-commerce: full passed`

## Boundaries preserved

- Existing `x-commerce-guest-capability` + same-origin authorization and frozen money/contact authority are unchanged.
- No order-number lookup route, UUID number parsing, guest-read renumbering, or current-store-setting inference was added.
- Internal `mode` and `paymentId` remain excluded from `checkout.order`.
