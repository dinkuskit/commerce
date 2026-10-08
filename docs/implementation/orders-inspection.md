# Installed Orders inspection

The sandbox descriptor declares `/orders`. The host authenticates private admin interactions; the controller additionally requires trusted `admin-page` context and `plugins:manage`. Browser-supplied identity is never trusted. Native compatibility pages are unchanged.

Canonical records live in `checkout_carts[].attempts[].order`; no order mirror is created. Only paid attempts with matching attempt identity are accepted. Duplicate order IDs, invalid aggregates, repeated/missing cursors and scan exhaustion fail closed. Reads scan at most 100 storage pages of 100 records and present 25 orders per admin page in canonical-ID order. Selection uses the encoded complete order ID, not a position. Missing selection is unavailable, never a fabricated order.

Recorded order/receipt/attempt/provider IDs, item names, catalog IDs, quantities, unit prices and total are displayed. When present, the frozen pricing snapshot supplies subtotal, coupon discount, net items and shipping. No pricing is recomputed from the current catalog. Missing historical breakdown is explicitly not recorded. Fulfillment stays Not recorded; no shipping state is inferred from payment. Ticket ids saved at checkout stay on the order and are not listed on the page. Pack builds the Inventory body (`stock.pack` or `stock.pack_all`) and, while `POST /v1/stock/pack` is absent from Inventory main, does not record the order as packed.

The Orders installer and shared admin helpers plus bounded checkout/coupon factoring retain the localization runtime, payment behavior, validation and unchanged official backend cap. Packaging must be revalidated after every source change; build success alone is insufficient.

Proof uses local SQLite and real workerd with the installed harness site (`tests/installed-coupon-site`, kept under its original name). Canonical completion uses a synthetic payment port and free checkout; no provider payment is mutated. Installed checks cover anonymous and forged-editor list/detail denial, keyboard selection, desktop/mobile, empty/unavailable recovery, and unchanged canonical storage during inspection. See FEATURE_MAP for executable drivers.

The initial delivery verifier reproduced a browser-proof mismatch: metadata now renders in one section, but the proof required each value to occupy a separate text element. Independent AutoReview P3 reported the same issue. Both installed and preview proofs now assert the visible labeled values without depending on that element subdivision; the installed and preview reruns passed. This is a proof repair, not removal of receipt/payment assertions.

When this was written the backend was close to the official 131072-byte per-file limit. Coupons have since left the Registry artifact (`docs/implementation/registry-coupons-deferred.md`), and `npm run build:sandbox` now repeats official package validation on every build. After that deferral, this slice measures `dist/sandbox/plugin.mjs` at 102216 bytes, 28856 under 131072.

Local installation uses the fixture’s genuine Registry-source runtime loading path with an unsigned package. Publisher verification, Registry discovery/consent, populated native migration, production deployment and live Stripe acceptance are not established.
