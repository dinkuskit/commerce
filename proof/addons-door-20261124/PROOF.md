# The add-ons door (commerce-addons-door-20261124)

Run on 24 Nov 2026 with Node 24.22.0 from this branch.

- `npm run build`: `registry_bundle=pass backend_bytes=131061 headroom_bytes=11` (main before this change: 131,045 bytes, 27 free). Commerce's coupon code is gone, so the door fits. The add-on size bound below costs 58 bytes.
- Unit suite (`node --test` over every `test:unit` glob): 852 tests, 852 pass.
- Integration suite (`node --test tests/integration/*.test.mjs`): 112 tests, 112 pass, including the three add-ons door cases in `registry-checkout-services.test.mjs`, which run the compiled Registry backend in workerd.
- `tests/features/orders/courier-outbox-runtime.test.mjs` (EmDash's own route dispatch): 4 pass, including `STORE_ONLY` for a signed-in Administrator and `order.paid` carrying the discount and the add-ons.

`orders-discount-line.png`: the Orders page renderer (`tools/orders-preview`) showing a synthetic order priced by the Coupons plugin. The discount line names the code the shopper used: "Discount SYNTHETIC5 −$5.00".

## The add-ons' size and the courier's 8 KB

The courier refuses a whole batch when one item is over 8 KB, and the receiver's bookmark then never moves (`src/features/orders/courier.ts`, from cb6c51e). `fit()` can only drop item lines, so the door now bounds what it keeps of the add-ons:

- Each add-on's `from`, `ref`, codes and line items are printable ASCII only, so a character is a byte.
- The `from`, `ref` and codes of all answers together are at most 1,500 characters.

`tests/features/orders/courier-outbox-runtime.test.mjs` puts the most the door accepts (4 add-ons, 1,500 characters) beside the longest address Commerce takes, with every address field 200 three-byte characters and a 200-character three-byte line name. The `order.paid` item is 6,491 bytes, with every ref and code kept and the line still in it. `registry-checkout-services.test.mjs` shows the compiled door refusing a non-ASCII ref, a code with a space, and four answers over 1,500 characters. The base commit checked only lengths, so it had neither check.

## Private routes through EmDash's own HTTP dispatch

Run on 24 Nov 2026 on a local template store (`scripts/dev-fresh.sh` with `DINKUS_PAIRED_COMMERCE_DIR` = this branch and `DINKUS_PAIRED_COUPONS_DIR` = dinkuskit/coupons#31). Commerce runs under its beta Registry id `r_fjzjvld3ssb4j63o`. The shopper added a mug, so they hold a real `dk_cart` cart key cookie. Responses are as returned:

| Caller | `POST /_emdash/api/plugins/r_fjzjvld3ssb4j63o/checkout/addons/start` with a contact and a 100%-off add-on answer |
| --- | --- |
| Anonymous, with the shopper's cart key cookie | `401 UNAUTHORIZED: Authentication required` |
| Signed-in Administrator | `400 ROUTE_ERROR … STORE_ONLY: Only the store's own code may use this door.` |

After both calls, the shopper's `/checkout` still shows the discount box, which only shows while no payment is held, so no checkout attempt was started. The store's own server code then priced the cart: Apply SPRING25 on `/checkout` showed "SPRING25 −$4.50" and the Discount row. A paid start through the door needs a store that takes payments. The compiled-runtime tests above cover the priced start, CONTENTION on a changed price and the zero-total order.

## Stored data after the upgrade

`COMMERCE_UPGRADE_FROM=v0.8.0 COMMERCE_UPGRADE_SPEC=registry-upgrade-cart-email.spec.mjs node scripts/registry-upgrade-proof.mjs` (Playwright pointed at the container's installed Chromium). Commerce 0.8.0 writes a shopper's cart key, that cart's unpaid checkout, a paid order and a saved catalog setting in its own shapes. Then this build runs, first on 0.8.0's EmDash and then on this checkout's EmDash, against the same database. All 3 phases passed. Every row stays as it was, the old cart key still answers, and no old order or cart becomes courier news.

Rows written before this change have no `addons`. A checkout attempt without them compares as `[]` when its cart is frozen, and an order without them sends `addons: []` in its paid news (`courier-outbox-runtime.test.mjs`, order-5). Commerce's Registry build never stored a coupon on an attempt or order, so nothing it wrote names the removed coupon fields.
