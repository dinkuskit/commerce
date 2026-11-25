# Tax's note on the Orders page's Sales tax row

dinkuskit/tax ledger entries `address-fallback-flag-order` and
`owner-typed-rate-uncovered-states`, which the owner approved on 24 Nov 2026.

- `orders-tax-note-1440.jpg`, `orders-tax-note-390.jpg`: the installed Registry
  Commerce's Orders page (EmDash 1.6.0 admin, Block Kit) for a checkout priced
  through `startCheckout` with a coupon's answer (`SAVE10`) and a tax answer
  carrying Tax's code `by-ZIP,-check-address`, received by the paid-order
  receiver. Rows read: Items subtotal $2.50, Discount SAVE10 −$0.50,
  Shipping $5.00, Sales tax · by ZIP, check address $0.66, Order total $7.66.
  The Discount row keeps only the code the shopper typed.
  Source: `tests/sandbox/orders-blocks.spec.mjs`, "installed Orders shows the
  sales tax of a taxed order, with Tax's note, on desktop and phone"
  (`npx playwright test --config=tests/orders-blocks.playwright.config.mjs -g "sales tax"`,
  run here with Playwright pointed at the container's installed Chromium).
- The same rows from the run:

```
ORDER_SALES_TAX_PROOF {"width":1440,"rows":[["Items subtotal","$2.50"],["Discount SAVE10","−$0.50"],["Shipping","$5.00"],["Sales tax · by ZIP, check address","$0.66"],["Order total","$7.66"]]}
ORDER_SALES_TAX_PROOF {"width":390,"rows":[["Items subtotal","$2.50"],["Discount SAVE10","−$0.50"],["Shipping","$5.00"],["Sales tax · by ZIP, check address","$0.66"],["Order total","$7.66"]]}
```

- `tests/features/orders/view.test.mjs` covers the other note,
  "rate typed by owner", and a taxed order at $0, which still shows the row.
