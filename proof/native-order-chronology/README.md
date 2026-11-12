# Native Orders chronology

Backroad Bum's Registry Commerce 0.8.0 list placed its newest payment fifth, behind older orders (commerce#265). This candidate changes only native list presentation before the 25-row page slice: parsed payment time descending, then short number descending, then exact order ID ascending. Missing or unparseable legacy times follow dated orders. `listOrders`, the private Orders API, numbering, Ship synchronization, frozen records and exact Inspect identities keep their contracts.

## Verification

Node 24.22.2; EmDash 1.4.0; sandbox-workerd 0.9.6; base `0ee0a23a2ec2b4285afc107734333eea493af3a3`.

- `bin/verify-commerce checks`: PASS — typecheck, 850 unit/workflow tests, repository/feature audits, 111 integration tests and Registry builds. Backend 129,447/131,072 bytes (1,625 headroom; +165 bytes from base).
- `npm exec playwright test -- --config=tests/orders-blocks.playwright.config.mjs --grep "latest payment"`: PASS — installed Registry-format artifact, synthetic receiver-admitted history, 1440/390px. Newest visible first; Next/Previous, keyboard Inspect and Back preserve chronology and exact receipt; Orders/numbering/Checkout rows unchanged.
- New unit cases cover sorting across page boundaries, timestamp offsets/equal instants, missing/unparseable legacy times, number/ID ties, unchanged core storage ordering, exact detail/Back, no extra synchronization/writes and malformed history outside the visible page.

Run local checks in a disposable network namespace when another EmDash runner occupies its default port18788. Install native dependencies normally (or rebuild both better-sqlite3 and workerd after an ignore-scripts install); the workerd JavaScript fallback can leave a grandchild behind on shutdown. No test expectation was bypassed in the final canonical checks run. Captures and generated proof databases stay out of git.

The targeted installed proof passes; the unrelated full browser/settings matrix is left to CI, not claimed locally. All fixtures are synthetic. The live signed store plugin remains unchanged; this is not publication or production deployment, and it does not address #258's scan-cost work.
