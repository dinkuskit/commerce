# Guest checkout coupon reasons proof (issue 34 follow-up)

Decision: `guest-checkout-coupon-reasons-035`, chosen by the project owner on
2026-10-10 ("Full detail" and "Refuse it"); it supersedes
`guest-checkout-coupon-unavailable-034`. Base: `5f15d6c` (main, after #85 and #87).

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

Node 22.23.3, `bin/verify-commerce full` on this source: PASS. After merging #87 (agent skill pins
only), `bin/verify-commerce quick` passes again with the same backend bytes and
SHA-256.

- `npm run test:unit`: 476 pass, 0 fail.
- `npm run test:integration`: 45 pass, 0 fail.
- `npm run test:sandbox`: 10 pass; `:native-local-stock` 1 pass; `:orders` 1 pass.

Registry backend `dist/sandbox/plugin.mjs`: 118,620 bytes, 12,452 under the
131,072 limit. SHA-256
`7f611224c5a315f8829a11e8ca3de05bb898b8123b2b920afe44701d234d3467`.
