# Guest checkout coupon reasons proof (issue 34 follow-up)

Decision: `guest-checkout-coupon-reasons-035`, chosen by the project owner on
2026-10-10 ("Full detail" and "Refuse it"); it supersedes
`guest-checkout-coupon-unavailable-034`. Base: `4791503` (main, after #85).

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

Node 22.23.2, `bin/verify-commerce full` on this source: PASS.

- `npm run test:unit`: 476 pass, 0 fail.
- `npm run test:integration`: 45 pass, 0 fail.
- `npm run test:sandbox`: 10 pass; `:native-local-stock` 1 pass; `:orders` 1 pass.

Registry backend `dist/sandbox/plugin.mjs`: 118,277 bytes, 12,795 under the
131,072 limit (main 117,441; +836). SHA-256
`0067000de77291bfe325481e92e1327c6bba0a34c59506ff2c91d0981e2d0494`.
