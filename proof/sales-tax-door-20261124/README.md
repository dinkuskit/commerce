# Sales tax through the add-ons door (24 Nov 2026)

Implements the Tax design the owner approved on 24 Nov 2026 (dinkuskit/tax ledger:
`tax-picks-rate-commerce-does-math`, `shared-addons-door`, `round-per-line-half-up`).

- `orders-sales-tax-1440.jpg`, `orders-sales-tax-390.jpg`: the installed Registry
  Commerce's Orders page (EmDash 1.5.0 admin, Block Kit) for a checkout priced
  through `startCheckout` with a coupon's answer and a tax answer, received by
  the paid-order receiver. Rows read: Items subtotal $2.50, Discount SAVE10
  −$0.50, Shipping $5.00, Sales tax $0.66, Order total $7.66.
  Source: `tests/sandbox/orders-blocks.spec.mjs`, "installed Orders shows the
  sales tax of a taxed order on desktop and phone"
  (`npx playwright test --config=tests/orders-blocks.playwright.config.mjs -g "sales tax"`).
- The arithmetic: mugs $1.50 less 50¢ off is $1.00, at 9.75% is 9.75¢, so 10¢;
  the tote $1.00 at 7% is 7¢; shipping $5.00 at 9.75% is 48.75¢, so 49¢.
- The compiled Registry runtime in workerd takes the same answers through
  `checkout/addons/start` (`tests/integration/registry-checkout-services.test.mjs`,
  "the add-ons door taxes a couponed checkout after the discount, for the
  address Tax priced"): an answer priced for the billing address of a shipped
  order is `CONTENTION`, malformed rates are refused, and Payments receives
  `tax` 60¢ and a $7.10 total.

## Upgrade from 0.8.0

`upgrade-from-0.8.0/` comes from this command:

```sh
COMMERCE_UPGRADE_FROM=v0.8.0 COMMERCE_UPGRADE_SPEC=registry-upgrade-sales-tax.spec.mjs node scripts/registry-upgrade-proof.mjs
```

The run printed `registry_upgrade=pass from=v0.8.0 phases=old,bridge,new`.

In the old phase, Commerce 0.8.0 keeps four things in its own untaxed shapes:

- a cart key;
- that cart's checkout, with its frozen `checkout-pricing/v1`;
- a paid order with its pricing;
- the order counter and a saved setting.

Then this build runs on 0.8.0's EmDash (bridge) and on this checkout's EmDash (new). In both phases:

- every row is byte for byte as 0.8.0 left it (`sales-tax-before-upgrade.json`);
- the old checkout opens and reads $0.00 tax;
- the order lookup answers the old order with its pricing and no tax key.

In the new phase, Orders shows the old order with no Sales tax row (`new-untaxed-order.jpg`). The rows are Items subtotal $12.00, Discount −$2.00, Shipping $5.00 and Order total $15.00.

A taxed checkout on this build is proved through the add-ons door in workerd, by `tests/integration/registry-checkout-services.test.mjs`.
