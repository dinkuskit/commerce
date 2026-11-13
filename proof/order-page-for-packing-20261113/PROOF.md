# Order page laid out for packing

PR #269 rearranges the Orders detail page for packing: the order number, paid time and status, a Test order banner and the actions come first. Below them sit an Items table (frozen choices, quantity, line total), Ship to beside Customer and Bill to as parcel lines, a Payment table, and an Order record fold with the IDs. Storage, the order record, permissions, actions and the agent `orders` route are unchanged.

## Captures

All captures are unedited Playwright full-page screenshots of the compiled Registry-format Commerce artifact, installed in the local EmDash 1.4.0 dev site (`tests/orders-blocks.playwright.config.mjs` harness), Node 24.15.0. Every name, address, email and phone number is synthetic (example.com and example.test).

| File | Source | Shows |
| --- | --- | --- |
| `before-main-1440.png` | main `37490ca` | The order as Label: value rows, 1440px. |
| `after-1440.png` | `6db7661` | Header and status line, Test order banner, actions, Items table, Ship to beside Customer and Bill to, Payment table, Order record fold, 1440px. |
| `before-main-390.png` | main `37490ca` | The same order at 390px. |
| `after-390.png` | `6db7661` | 390px: tables full width, address and contact in two columns, no page overflow. |
| `after-completed-1440.png` | `6db7661` | A Completed order with a corrected address, the Shipped block (carrier, tracking) and the Order record fold open (`orders-completed` capture of `tests/sandbox/orders-blocks.spec.mjs`). |

The before and after pairs come from a one-off spec in the same harness. It stores the same synthetic order (three lines, two with size or colour choices, free shipping, one address used for both shipping and billing) on each build and opens it at 1440px and 390px.

## Verification

- `npm run typecheck` and `npm run audit:repo`: clean.
- `npm run test:unit`: 851 pass. `node --test tests/integration/*.test.mjs`: 111 pass.
- `tests/sandbox/orders-blocks.spec.mjs`, both tests, pass against the installed artifact.
- Registry backend: 130,006 of 131,072 bytes, 1,066 bytes of headroom.

EmDash 1.4 `columns` blocks never stack on narrow screens, so tables stay full width and only short address and contact text uses columns.
