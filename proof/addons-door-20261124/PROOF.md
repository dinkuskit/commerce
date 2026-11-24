# The add-ons door (commerce-addons-door-20261124)

Run on 24 Nov 2026 with Node 24.22.0 from this branch.

- `npm run build`: `registry_bundle=pass backend_bytes=131003 headroom_bytes=69` (main before this change: 131,045 bytes, 27 free). Commerce's coupon code is gone, so the door fits.
- Unit suite (`node --test` over every `test:unit` glob): 852 tests, 852 pass.
- Integration suite (`node --test tests/integration/*.test.mjs`): 112 tests, 112 pass, including the three add-ons door cases in `registry-checkout-services.test.mjs`, which run the compiled Registry backend in workerd.
- `tests/features/orders/courier-outbox-runtime.test.mjs` (EmDash's own route dispatch): 4 pass, including `STORE_ONLY` for a signed-in Administrator and `order.paid` carrying the discount and the add-ons.

`orders-discount-line.png`: the Orders page renderer (`tools/orders-preview`) showing a synthetic order priced by the Coupons plugin. The discount line names the code the shopper used: "Discount SYNTHETIC5 −$5.00".
