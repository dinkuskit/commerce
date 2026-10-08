# Installed Orders inspection

The sandbox descriptor declares `/orders`. The host authenticates private admin interactions; the controller additionally requires trusted `admin-page` context and `plugins:manage`. Browser-supplied identity is never trusted. Native compatibility pages are unchanged.

Canonical records live in `checkout_carts[].attempts[].order`; no order mirror is created. Only paid attempts with matching attempt identity are accepted. Duplicate order IDs, invalid aggregates, repeated/missing cursors and scan exhaustion fail closed. Reads scan at most 100 storage pages of 100 records and present 25 orders per admin page in canonical-ID order. Selection uses the encoded complete order ID, not a position. Missing selection is unavailable, never a fabricated order.

Recorded order/receipt/attempt/provider IDs, item names, catalog IDs, quantities, unit prices and total are displayed. When present, the frozen pricing snapshot supplies subtotal, coupon discount, net items and shipping. No pricing is recomputed from the current catalog. Missing historical breakdown is explicitly not recorded. Fulfillment is always Not recorded; no shipping state is inferred from payment. Pack builds the Inventory command in [order-pack.md](order-pack.md) and, with no hosted pack route, fails closed without writing the order.

The Orders installer and shared admin helpers plus bounded checkout/coupon factoring retain the localization runtime, payment behavior, validation and unchanged official backend cap. Packaging must be revalidated after every source change; build success alone is insufficient.

Proof uses local SQLite and real workerd with the installed coupon fixture. Canonical completion uses a synthetic payment port and free checkout; no provider payment is mutated. Installed checks cover anonymous and forged-editor list/detail denial, keyboard selection, desktop/mobile, empty/unavailable recovery, and unchanged canonical storage during inspection. See FEATURE_MAP for executable drivers.

The initial delivery verifier reproduced a browser-proof mismatch: metadata now renders in one section, but the proof required each value to occupy a separate text element. Independent AutoReview P3 reported the same issue. Both installed and preview proofs now assert the visible labeled values without depending on that element subdivision; the installed and preview reruns passed. This is a proof repair, not removal of receipt/payment assertions.

The backend remains close to the official 131072-byte per-file limit. No minifier, dependency, localization, or limit bypass is part of this change. Future edits must repeat official package validation; this is fragile headroom, not a maintenance reserve.

Local installation uses the fixture’s genuine Registry-source runtime loading path with an unsigned package. Publisher verification, Registry discovery/consent, populated native migration, production deployment and live Stripe acceptance are not established.
