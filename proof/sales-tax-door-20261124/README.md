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
