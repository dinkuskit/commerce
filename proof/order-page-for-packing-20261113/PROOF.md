# Order page laid out for packing

PR #269 rearranges the Orders detail page the way WooCommerce's order screen reads. First come the order number, paid time and status, and a Test order banner. Then Ship to (with Correct address) sits beside Customer and Bill to, as parcel lines. Below that, an "N items ready to ship" line carries the main action (Create shipping label or Complete order), followed by an Items table (frozen choices, price, quantity, line total), a payment table, and an Order record fold with the IDs. Storage, the order record, permissions, actions and the agent `orders` route are unchanged.

## Captures

All captures are unedited Playwright full-page screenshots of the compiled Registry-format Commerce artifact, installed in the local EmDash 1.4.0 dev site (`tests/orders-blocks.playwright.config.mjs` harness), Node 24.15.0. Every name, address, email and phone number is synthetic (example.com and example.test).

| File | Source | Shows |
| --- | --- | --- |
| `before-main-1440.png` | main `37490ca` | The order as Label: value rows, 1440px. |
| `after-1440.png` | this PR | Header and status line, Test order banner, Ship to beside Customer and Bill to, the ready-to-ship line with Complete order, Items and payment tables, Order record fold, 1440px. |
| `before-main-390.png` | main `37490ca` | The same order at 390px. |
| `after-390.png` | this PR | 390px: addresses and contact in two columns, tables full width, no page overflow. |
| `after-completed-1440.png` | this PR | A Completed order with a corrected address, the Shipped line (date, carrier, tracking) with Move back to Processing, and the Order record fold open (`orders-completed` capture of `tests/sandbox/orders-blocks.spec.mjs`). |

The before and after pairs come from a one-off spec in the same harness. It stores the same synthetic order (three lines, two with size or colour choices, free shipping, one address used for both shipping and billing) on each build and opens it at 1440px and 390px.

## Verification

- `npm run typecheck` and `npm run audit:repo`: clean.
- `npm run test:unit`: 851 pass. `node --test tests/integration/*.test.mjs`: 111 pass.
- `tests/sandbox/orders-blocks.spec.mjs`, both tests, pass against the installed artifact.
- Registry backend: 130,066 of 131,072 bytes, 1,006 bytes of headroom.

EmDash 1.4 `columns` blocks never stack on narrow screens. Three columns (WooCommerce's General, Billing, Shipping) overlap at 390px, so the page uses two: Ship to, then Customer and Bill to. Tables stay full width.
