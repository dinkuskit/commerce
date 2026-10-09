# Current-head proof after main merge (#68, #70)

This file supersedes the bundle-size, packaging and installation-gate
statements in `COMPOSITION.md` and `MAIN-INTEGRATION.md` in this folder. Those
recorded the stack before #75 moved coupons out of the Registry build; their
oversized-backend (141,201 bytes) and installed-coupon packaging findings no
longer hold.

Source: branch `codex/commerce-checkout-contact-20261008` with the #70 head
(main at `be52f8f` plus the initial US delivery decisions) merged in.

## Merge resolution

- `src/features/checkout/guest.ts`: start input accepts `contact` alongside
  `lines` (and `couponCode` for pricing starts) with main's line-count and
  coupon-length bounds; main's prepare and status input admission is kept and
  prepare still loads the authoritative contact requirements.
- `src/features/checkout/route.ts`: the native runtime gets both the contact
  requirements loader and main's entry-bound coupon port.
- `src/features/checkout/types.ts`: main's `CheckoutCouponPort` with this
  PR's contact types.
- `tests/integration/registry-checkout-services.test.mjs`: main's
  coupon-free Registry flow with the required contact email.
- `tests/features/checkout/checkout-pricing-recovery.test.mjs`: main's new
  "pricing without bound coupon support" test now sends synthetic contact,
  since every new checkout requires email.
- GrillTrack: main's ledger kept as is; `checkout-contact-email-phone-20261008`
  replayed through the CLI (proposed, locked, implemented with its
  implementation ref). `./scripts/grilltrack validate`: valid.

## Checks on this head

- `npm run build:sandbox`: `registry_bundle=pass backend_bytes=113755 headroom_bytes=17317`.
- `bin/verify-commerce quick`: 414 unit tests pass, typecheck passes,
  `public_repository_contract=clean`, `feature_contract=clean`.
- `npm run test:integration`: 41 pass, 0 fail, 0 skipped.
- `playwright.config.mjs`: 10 of 10 pass (sandbox, native, native-variant).
- `tests/merchant-settings.playwright.config.mjs`: 2 of 2 pass.

Browser runs used local Chromium. Local proof only. Not Registry publication.
