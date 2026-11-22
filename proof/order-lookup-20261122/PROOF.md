# Order lookup and the move of shopper accounts to DinkusKit Accounts

GrillTrack `commerce-order-lookup-20261122` (supersedes `shopper-accounts-v1-20261020`), approved by the owner on 2026-11-21 (scope) and 2026-11-22 (guess limit).

## Size

The Registry backend falls from 130,739 bytes (the EmDash 1.5 branch this builds on, at 7514034) to 124,531 bytes, 6,541 below the 131,072 cap (`main` at c9b24fc, after the review fixes): the shopper-account code leaves (about 8.8 KB) and the order lookup adds about 2.5 KB.

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

- `npm run test:unit` files: 880 of 880 pass, including `tests/features/orders/lookup.test.mjs` (1-hour wait to the second, lock by order number, origin and input refusals, background clean-up; a burst of 12 lookups at once for one order number reads orders 5 times and answers the rest `LOOKUP_LIMITED`; a try that cannot be recorded reads no order; right guesses give their tries back; an order kept before the email index, with no `emailKey`, is still found). `tests/features/checkout/checkout-contact-integration.test.mjs` starts workerd, which cannot start in the cloud container used here (`miniposix::write ... Bad file descriptor`); CI runs it.
- Sandbox Playwright suite: 12 of 12 pass, with the order lookup spec in place of the retired shopper profile spec.
- `tsc`, `check-features` and `repo-contract`: clean.

## Upgrade from v0.8.0 (existing orders and shopper accounts)

Command, run on Node 24.22.0:

```
npm run build
COMMERCE_UPGRADE_FROM=v0.8.0 COMMERCE_UPGRADE_SPEC=registry-upgrade-order-lookup.spec.mjs node scripts/registry-upgrade-proof.mjs
registry_upgrade=pass from=v0.8.0 phases=old,bridge,new
```

`tests/sandbox/registry-upgrade-order-lookup.spec.mjs` runs against one SQLite database in three phases:

- **old**: v0.8.0's Registry build on v0.8.0's own EmDash.
  - It keeps three paid orders in the shape v0.8.0's receiver stores (`{ paidOrder, emailKey, number, revision }`). The third, #1003, comes from before the `emailKey` index and has no `emailKey`.
  - It also keeps the order counter and a customer, a used login code and a session in the shopper-account collections.
  - v0.8.0 has no `orders/lookup` route.
- **bridge**: this build on v0.8.0's EmDash (`order-lookup-upgrade-bridge.json`).
  - It finds #1001 by `#1001` + `PAT@example.test`, and #1003, the order without an index entry, by its email.
  - #1003 with Pat's email is `ORDER_NOT_FOUND`.
  - After five wrong emails for #1002, Sam's right email is `LOOKUP_LIMITED`, and `number:1002` holds 5 tries.
- **new**: this build on this checkout's EmDash 1.5 (`order-lookup-upgrade-new.json`).
  - The order, order-number and removed shopper-account rows equal v0.8.0's rows byte for byte, both before and after the lookups.
  - #1002 is still `LOOKUP_LIMITED`: the lock made before the EmDash upgrade holds.
  - #1001 and #1003 are found, and #1001 with Lee's email is not.
  - The old `account/orders` route no longer answers.
  - No answer carries a payment id.

Guess rows hold only `email:<sha256>` and `number:<n>` ids.
