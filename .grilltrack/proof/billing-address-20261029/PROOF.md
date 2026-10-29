# Billing address on orders: proof

Decision: `commerce-billing-address-001` (owner, 2026-10-29), with the amended
`commerce-delivery-address-001`. Record: [docs/decisions/billing-address.md](../../../docs/decisions/billing-address.md).
Baseline: `d61d2d2`. Environment: Node 24.22.0, EmDash 1.2.0.

## Observed acceptance

| Requirement | Evidence |
| --- | --- |
| Every checkout needs billing, checked like delivery, any country | `tests/features/checkout/checkout-contact.test.mjs` "every checkout needs a billing address": missing billing refused as `BILLING_INVALID` for digital and physical baskets (no copy from delivery); blank, missing, control-character, three-letter-country, unknown-field and over-long billing refused; Canadian billing accepted with US delivery; digital basket drops delivery and keeps billing |
| Frozen full copy rides the paid order | Same file: snapshot and its billing are frozen and detached from the input; `delivery-address.test.mjs` paid order carries `contactSnapshot.contact.billing` unchanged |
| Orders detail | `tests/features/orders/view.test.mjs` "the detail shows the customer and both addresses": Email, Phone, Ship to, Bill to in that order; "Same as delivery address" when equal; full billing when different or after Correct address; "Not recorded" on an order paid before billing; valid Block Kit |
| Agents' orders API | `tests/features/orders/api.test.mjs`: `billTo` full copy and `billToMatchesShipTo`; false after a delivery correction; null/false on older orders. Ship's payload (`orderFacts`) is unchanged |
| Storefront contract in the sandbox and integration sites | Integration (workerd) and sandbox storefront fixtures send `billing`; the sandbox site sends a copy of delivery when "Billing address same as delivery address" is ticked |
| Storefront in a real browser | `npm run test:sandbox`: 10 of 10 pass (variant checkout fills billing for digital baskets, including after a reload, and the snapshot carries it). `npm run test:sandbox:orders`: 3 of 3 pass |
| Unit and integration suites | `npm test`: 800 of 801 pass; the one failure is `tests/workflows/packaged-consumers.test.mjs` teardown, which fails on main in cloud containers (process-group signals). `npm run test:integration`: 110 of 110 pass. `npm run typecheck`, `npm run audit:repo` and GrillTrack validation pass |
| Registry bundle under the cap | `node scripts/build-sandbox.mjs`: backend 131,025 bytes, 47 bytes free under 131,072 (main `d61d2d2` measured 131,044, 28 free). Room came from removing the duplicated contact-snapshot copy in checkout, one shared Payments request helper for checkout and wakes, a single binding-mismatch check, a Blob-based body join, shorter order sorting in Orders, and one billing error code |

Payments, Stripe and Authorize.net are unchanged.

## Reverified after reopening the delivery-address decision

Re-locking `commerce-delivery-address-001` marked its dependents for
reverification. Their behavior is unchanged and their suites pass on this head:
`commerce-order-identity-001` and `commerce-order-status-001`
(`tests/features/orders/identity.test.mjs`, `status.test.mjs`, `page.test.mjs`),
`commerce-product-weight-001` (catalog weight tests), `commerce-orders-api-001`
(`api.test.mjs`, which now also covers `billTo`), `commerce-ship-sync-001`
(`ship.test.mjs` and the workerd Ship payload assertion in
`tests/integration/registry-checkout-services.test.mjs`: the order sent to Ship
carries no billing) and `commerce-background-check-001` (background-check unit and
integration tests).
