# EmDash 1.6.0 upgrade proof

Taken 25 Nov 2026 by `npm run test:registry-upgrade` on Node 24.22.0, after `npm run build` of this branch
(Registry backend 131,010 bytes, byte-identical to `main`). Each run uses one SQLite database through every phase:
"old" (the earlier release on its own EmDash), "bridge" (this build on that same EmDash, for 0.8.0 and later) and
"new" (this build on this checkout's EmDash 1.6.0).

## From 0.8.0: products, prices, settings and orders

`COMMERCE_UPGRADE_FROM=v0.8.0 COMMERCE_UPGRADE_SPEC=registry-upgrade-linked-archive.spec.mjs` (3 phases pass):

1. `1-upgrade-0-8-0-on-1-4.png`: Commerce 0.8.0 on its EmDash 1.4.0 makes, prices, sells and archives a product.
2. `2-upgrade-new-commerce-on-1-4-duplicate-refused.png`: this build on the same EmDash 1.4.0 keeps every stored
   row (catalog items, prices, availability, out-of-stock listing, SKU claims, product pages, settings) and
   refuses a second page taking the product's SKU.
3. `3-upgrade-on-1-6-product-kept.png`: the store restarts on EmDash 1.6.0. Every stored row and the saved
   "Hide out-of-stock products" setting are unchanged, and the product is on the shop with 0.8.0's prices.
4. `4-upgrade-on-1-6-duplicate-refused.png`: on 1.6.0 the duplicate SKU is still refused.

`COMMERCE_UPGRADE_SPEC=registry-upgrade-orders-paging.spec.mjs` (3 phases pass): 56 orders kept as 0.8.0
keeps them keep their numbers and checkout copies on 1.6.0. `5-upgrade-on-1-6-orders-kept.png` is the Orders
page on the upgraded store; its footer reads EmDash v1.6.0.

`COMMERCE_UPGRADE_SPEC=registry-upgrade-order-lookup.spec.mjs` (3 phases pass): three paid orders and the old
shopper-account rows are byte-for-byte unchanged on 1.6.0, order #1001 is found by number and email in any
letter case, a wrong pair is not, and the lock on #1002 made before the EmDash move still holds.
`0-8-0-order-lookup-on-1-6.json` is the 1.6.0 trace.

## From 0.5.0

`npm run test:registry-upgrade` (default spec, 2 phases pass): Commerce 0.5.0 on its EmDash 1.2.0, then this build
on 1.6.0. Products, settings, policy and native rows are kept and the shop is unchanged
(`6-upgrade-from-0-5-0-on-1-6-settings.png`); a duplicate SKU is refused (`7-upgrade-from-0-5-0-on-1-6-duplicate-refused.png`).

## EmDash 1.5 to 1.6, in either order

- **Commerce first.** `COMMERCE_UPGRADE_FROM=v0.9.0-beta.5 COMMERCE_UPGRADE_SPEC=registry-upgrade-order-lookup.spec.mjs`
  (3 phases pass): 0.9.0-beta.5 on its EmDash 1.5.0 keeps three paid orders; this build takes over on 1.5.0
  (`beta5-order-lookup-on-1-5.json`: #1001 found, five wrong emails lock #1002); the store moves to 1.6.0
  (`beta5-order-lookup-on-1-6.json`: the rows are unchanged, #1001 is still found and the lock still holds).
- **EmDash first.** template-store #279 upgraded a filled EmDash 1.5.0 store running Commerce 0.9.0-beta.5 to
  1.6.0 and compared it field by field: products, catalog, Commerce storage, unique indexes and plugin state
  were all equal, and new products, carts and checkouts worked afterwards. See that PR's
  `.grilltrack/proof/emdash-1-6-20261125/upgrade-from-1-5-0.md`.

See [the compatibility record](../../docs/implementation/emdash-1-6-compatibility.md).
