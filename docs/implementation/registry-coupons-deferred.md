# Coupons deferred from the Registry artifact

Update, 2026-10-09: Registry checkout applies coupons again through the hosted
DinkusKit coupon service when the owner configures it; see
[registry-hosted-coupons](registry-hosted-coupons.md). The artifact still
carries no coupon storage, admin page, evaluator or redemption code.

On 2026-10-08 the project owner (GitHub `saariuslystoned`) chose to ship the
first Registry release of Commerce without coupons. Coupons return later as
their own unit rather than inside the Commerce backend.

## Why

EmDash 1.2.0's official packager (`@emdash-cms/plugin-cli` 0.13.3,
`bundlePlugin`) rejects any decompressed file over 131,072 bytes. The Commerce
backend is one file, so every feature in the sandbox entry shares that cap.

| Build | `backend.js` bytes | Result |
| --- | ---: | --- |
| `main` before PR 66 | 130,243 | passes with 829 spare |
| `main` after PR 66 | 130,798 | passes with 274 spare |
| PR 68 head | 137,927 | rejected |
| PR 69 head | 141,201 | rejected |
| PR 68 with coupons stubbed | 108,764 | passes |
| PR 69 with coupons stubbed | 112,035 | passes |
| This change on `main` after PR 66 | 102,045 | passes with 29,027 spare |

Re-minifying with another tool saved nothing. EmDash 1.2 has no
plugin-to-plugin call (`PluginContext` has no cross-plugin port, `ctx.http`
only reaches static `allowedHosts`, storage is per plugin), so a separate
coupons plugin on the same site cannot be called by checkout. Returning
coupons means a hosted service reached over HTTP, as Payments and Inventory
already are.

## What changed

The Registry artifact no longer declares `coupons` storage or the `/coupons`
admin page, and its backend contains no coupon admin, evaluator or redemption
code. About 1 KB remains (`normalizeCouponCode` and `CouponRedemptionError`),
which checkout uses to reject a coupon code as unavailable before any attempt
write or Payments call.

Checkout reaches coupons only through `CheckoutCouponPort`
(`src/features/coupons/checkout.ts`). The native entry binds it from its own
`coupons` storage; the sandbox entry binds nothing, so the bundler drops the
coupon modules. Hosts still cannot supply coupon storage or a port.

`createTrustedTestPaymentsCheckoutHost` now takes an optional
`validateCouponQuoteSnapshot`. Without it, a payment request that carries a
coupon is malformed. The Registry services pass none.

`npm run build:sandbox` now runs `scripts/check-registry-bundle.mjs`, which
packages the staged source with the official `bundlePlugin` and fails the
build over the limit. It prints the backend bytes, headroom and hash.

## What stays

The native entry keeps coupon storage, the coupon admin page and coupon
checkout. `src/admin/coupons-*.ts`, the audited auth transform and the coupon
catalog stay in the repository with their unit tests, unmounted from the
sandbox admin. The installed Orders browser proof moved from the coupon
browser spec to `tests/sandbox/orders-blocks.spec.mjs`
(`npm run test:sandbox:orders`); the coupon browser spec and its config were
removed because the installed artifact has no coupon page.

## Compatibility

- Template Store pins Commerce by commit, so nothing changes there until it
  bumps. A native host that builds checkout through
  `createTrustedTestPaymentsCheckoutHost` and accepts coupons must then pass
  `validateCouponQuoteSnapshot` from `@dinkuskit/commerce/features/coupons`.
- Registry checkout attempts that already recorded a coupon fail closed.
  Nothing has been released, so no installed site holds such attempts.

## Open pull requests

PRs 68 and 69 should merge `main` after this lands and re-run
`npm run build:sandbox`. Conflicts are expected in `pricing.ts`,
`orchestrate.ts`, `runtime.ts` and the Registry integration tests, where
coupon calls now go through `pricing.coupons`.
