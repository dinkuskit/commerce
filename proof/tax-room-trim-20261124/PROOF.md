# Making room for Tax (commerce#307)

The Registry backend goes from 131,057 bytes (main 2b4537f, 15 free) to 130,370 bytes (702 free), measured with `npm run build`.

## What changes and what does not

- **Payment windows: no behaviour change.** An attempt frozen with the old `paymentWindowSeconds: 1800` is still accepted for an exact 1,800-second session, and a current request for 1,800 to 1,860 seconds. The check is written out in `providerSessionWindowIsValid`, so the Registry build no longer carries the handoff objects. `payment-window.test.mjs` and `checkout-contact-integration.test.mjs` are unchanged from main and pass, including "frozen old paymentWindowSeconds:1800 remains exact across retry and restart" and the active historical original reaching a paid order.
- **Ship pins: no behaviour change.** Orders still never sends an order carrying a `shipPin` to Ship and never completes one from it (`ship.test.mjs`, unchanged from main).
- **The retired isolated Ship TEST profile is refused.** A store whose saved checkout setting still names the exact 0.3.0-beta.0 to beta.2 sandbox profile used to keep checkout with Ship dropped. It now gets the same refusal as any other form of that profile: checkout is closed until the store connects again through DinkusKit.com, which writes the real Ship service.
- **Inventory errors leave the Registry build.** Only a managed-stock item raises "Inventory setup required" or "Inventory unavailable", or needs an inventory reserve, and the Registry build never has one (`quote.ts` passes no stock management there). The native build keeps them.

## Who holds the retired profile

The beta store's database, read with a single `SELECT` on 24 Nov 2026: its `installedCheckout` setting has no `ship-sandbox` profile, and no order carries a `shipPin`. No other store runs Commerce.

## The store with the retired profile, then connected normally

A fresh local template store (template-store main 1662715) ran this branch's Registry build, with Payments stood in by template-store's `tests/paired/helpers/dinkuskit-stand-in.mjs` ([trim-trace.txt](trim-trace.txt)). A shopper put the mug in the cart.

1. With the setting naming the retired profile, `/checkout` showed "The cart is unavailable right now", and the banner read "Purchases and checkout are unavailable" (`trim-1-retired-ship-refused.jpg`).
2. With the same setting minus that profile, `/checkout` showed the checkout form (`trim-2-normal-checkout.jpg`).

In the compiled runtime (`registry-checkout-services.test.mjs`), a store saving the profile gets `UNAVAILABLE` from prepare, and its 5-minute check makes no call to Ship or to `ship.sm0ky.dev`.

## Stored data after the upgrade

`COMMERCE_UPGRADE_FROM=v0.9.0-beta.6 COMMERCE_UPGRADE_SPEC=registry-upgrade-cart-email.spec.mjs node scripts/registry-upgrade-proof.mjs`, with Playwright pointed at the container's installed Chromium ([upgrade-trace.txt](upgrade-trace.txt); the spec's titles say 0.8.0, its first release, but this run started from v0.9.0-beta.6). The latest beta wrote a shopper's cart key, that cart's unpaid checkout, a paid order and a saved setting. This build then ran on that release's EmDash and on this checkout's EmDash against the same database. All 3 phases passed, and every row stayed as it was (`upgrade-new-settings.jpg`, the settings page after the upgrade).
