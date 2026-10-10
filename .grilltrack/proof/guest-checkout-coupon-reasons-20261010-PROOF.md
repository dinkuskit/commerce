# Guest checkout coupon reasons proof (issue 34 follow-up)

Decision: `guest-checkout-coupon-reasons-035`, chosen by the project owner on
2026-10-10 ("Full detail" and "Refuse it"); it supersedes
`guest-checkout-coupon-unavailable-034`. Base: `00e3544` (main, after #85, #87, #84 and #88).

## Behaviour

`COUPON_UNAVAILABLE` now carries a `reason` (and `minimum` with
`minimum-not-met`): `not-found` (unknown or turned off), `not-started`,
`expired`, `minimum-not-met`, `no-qualifying-items`, `used-up`, `try-later`,
and `not-applicable` only as the fallback when the coupon owner gives no finer
reason. The evaluator now refuses a cart with no qualifying line instead of
quoting a zero discount. The hosted port passes on the coupon service's
`NOT_APPLICABLE` `reason` and `minimum` when Commerce knows them; until the
coupon service sends them, hosted stores report `not-applicable`.
Attempts saved by #85 with `coupon.refused: true` answer `not-applicable`, so
no stored record can show a reason outside the list.

Tests: `tests/features/checkout/checkout-pricing-recovery.test.mjs` (each
reason, in process and again through the hosted port via
`checkout-pricing-hosted.test.mjs`), `registry-coupons.test.mjs` (including a `refused: true` attempt saved before reasons),
`tests/features/coupons/acceptance.test.mjs`,
`tests/integration/registry-checkout-services.test.mjs` (compiled Registry
backend under workerd reports `try-later`).

## Verification

Node 22.23.2, `bin/verify-commerce full` on head after merging main `00e3544`
(#88, delivery address at checkout): PASS.

- `npm run test:unit`: 489 pass, 0 fail.
- `npm run test:integration`: 46 pass, 0 fail.
- `npm run test:sandbox`: 10 pass; `:native-local-stock` 1 pass; `:orders` 1 pass.

Registry backend `dist/sandbox/plugin.mjs`: 120,348 bytes, 10,724 under the
131,072 limit (main 119,448; +900). SHA-256
`c89c485d013121e9ad6fec1d2077198ca4875300da1d24fd91d1713249c196bd`.
