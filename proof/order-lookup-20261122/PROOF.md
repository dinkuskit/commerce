# Order lookup and the move of shopper accounts to DinkusKit Accounts

GrillTrack `commerce-order-lookup-20261122` (supersedes `shopper-accounts-v1-20261020`), approved by the owner on 2026-11-21 (scope) and 2026-11-22 (guess limit).

## Size

The Registry backend falls from 130,730 bytes (the EmDash 1.5 branch this builds on) to 124,193 bytes, 6,879 below the 131,072 cap: the shopper-account code leaves (about 8.8 KB) and the order lookup adds about 2.2 KB.

## Real EmDash store

`tests/sandbox/order-lookup.spec.mjs` runs on the sandbox proof site (EmDash 1.5.0, the built Registry Commerce in the sandbox runner). It writes two fixture orders, #4001 for `Pat.Lookup@example.test` and #4002 for `sam.lookup@example.test`, then calls `POST /_emdash/api/plugins/dinkus-commerce/orders/lookup` over HTTP. `order-lookup-trace.json` is the full trace. In short:

| Request | Answer |
| --- | --- |
| `#4001` + `pat.lookup@EXAMPLE.test` | 200, `no-store`, `ok: true`, order #4001 with its delivery address; no payment id |
| `4002` + Pat's email (Sam's order) | `ORDER_NOT_FOUND` |
| `4999` + Pat's email | `ORDER_NOT_FOUND` (same message) |
| `4001` + Pat's email from `https://evil.example.test` | 403 `CSRF_REJECTED` from EmDash; no guess counted |
| 3 more wrong numbers for Pat's email (5 wrong in all) | `ORDER_NOT_FOUND` |
| `4001` + Pat's email (right) | `LOOKUP_LIMITED`: "Too many tries. Try again in an hour." |
| `4002` + Sam's email | `ok: true`, order #4002 |

The guess rows hold no email: ids are `email:<sha256>` and `number:<n>`.

## Commands (Node 24.22.0)

- `npm run test:unit` files: 875 of 875 pass, including `tests/features/orders/lookup.test.mjs` (1-hour wait to the second, lock by order number, origin and input refusals, background clean-up). `tests/features/checkout/checkout-contact-integration.test.mjs` starts workerd, which cannot start in the cloud container used here (`miniposix::write ... Bad file descriptor`); CI runs it.
- Sandbox Playwright suite: 12 of 12 pass, with the order lookup spec in place of the retired shopper profile spec.
- `tsc`, `check-features` and `repo-contract`: clean.
