# Paid-order handoff, handoff contracts and backend trim (2026-10-10)

Decision: `commerce-paid-order-handoff-001` (locked on the owner's approval,
2026-10-10 03:01 UTC). Contract: `docs/contracts/commerce-handoffs.md`.

## Registry backend size

| | `dist/sandbox/plugin.mjs` bytes | headroom to 131,072 |
| --- | --- | --- |
| main 240acd5 | 117,068 | 14,004 |
| after Orders copy, Catalog quote, admin split (8823272) | 120,170 | 10,902 |
| this branch after trims | 116,709 | 14,363 |

Measured with `npm run build` (`scripts/check-registry-bundle.mjs` prints
`registry_bundle=pass backend_bytes=...`). The trims (about 6.4 KB) pay for
the new Orders copy, its page changes, the Catalog quote and the admin split
(about 3.1 KB), leaving the file 359 bytes smaller than main.

## Checks run on this head

`bin/verify-commerce full` with Node 22.23.2:

- typecheck clean; `npm run test:unit` 478 of 478 pass
- `npm run audit:repo`: `public_repository_contract=clean`, `feature_contract=clean`
- `npm run test:integration` 46 of 46 pass
- `npm run test:sandbox` 10 of 10 pass (fresh install clerk flow, media,
  guest routes, variants, native continuity)
- `npm run test:sandbox:native-local-stock` 1 of 1 pass
- `npm run test:sandbox:orders` 1 of 1 pass (installed Orders brings in older
  orders on first open, reads only its own copies, fails closed on a
  malformed kept copy or Checkout record, denies non-managers)

Handoff-specific tests: `tests/features/checkout/paid-order-handoff.test.mjs`
(record built from the frozen order, failed hand-off retried on the next
check without changing the shopper outcome, unpaid attempts hand nothing),
`tests/features/checkout/installed-context.test.mjs` (a paid wake run through
the exported `createInstalledCheckoutWakeHook` hands its order to Orders),
`tests/features/orders/page.test.mjs` (first copy kept, repeats and
conflicts, malformed records refused), `tests/integration/orders-inspection.test.mjs`
(real SQLite: live hand-off, bring-in, conflict report, paging),
`tests/feature-boundaries.test.mjs` (front-door and storage-name audit).
