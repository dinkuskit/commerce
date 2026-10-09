# Registry coupon deferral proof

Source intent: CLI-locked `registry-coupons-deferred-20261008`, superseding
`coupons-registry-block-kit-001`. Base: `717c895` (main after PR 66). Details and measurements:
`docs/implementation/registry-coupons-deferred.md`.

## Artifact

`npm run build:sandbox` packages the staged source with the official
`@emdash-cms/plugin-cli` 0.13.3 `bundlePlugin` and reports:

- `backend.js`: 102,045 bytes, 29,027 under the 131,072-byte file limit.
- `backend.js` SHA-256: `f70eab9e628a1df5caccbedfab4c6826bd5dab30e371982d0602f2946ec4ac49`.
- Storage: no `coupons` collection. Admin pages: no `/coupons`.

The same base measured 130,798 bytes (274 spare) before this change.

## Behavior

The compiled backend under real workerd and SDK SQLite CAS rejects a coupon
code as unavailable before any attempt write or Payments call, then checks out
the same capability without one. Coupon admin, evaluator and redemption markers
are absent from the shipped backend. A zero-priced cart still writes one
payment-free order with no transport, and zero-priced merchandise with positive
shipping still uses Payments. Native checkout keeps coupon quoting and
redemption through the entry-bound `CheckoutCouponPort`; a host cannot supply
one. A test-payments port without a coupon validator treats a coupon-bearing
request as malformed.

The audited auth transform (`coupons-registry-packaging-001`) still runs on
every sandbox build for the Orders `plugins:manage` check, and the official
packager accepts its output.

## Verification

Node 22.22.0 with `npm ci --engine-strict=false` (the container lacks 22.23.2);
Playwright used the container's Chromium build:

- `npm run typecheck`: PASS.
- `npm run audit:repo`: clean.
- `npm run build:sandbox`: `registry_bundle=pass`.
- `npm run test:unit`: 353 PASS.
- `npm run test:integration`: 41 PASS, including real compiled workerd.
- `npm run test:sandbox`: 10 PASS.
- `npm run test:sandbox:native-local-stock`: 1 PASS.
- `npm run test:sandbox:orders`: 1 PASS on the installed Registry-format artifact.

Not established: Registry publication, a hosted coupons service, live Stripe.
