# Frozen choices in Orders

A new paid Stripe TEST checkout on backroadbum.com bought two members of the same tee family. The storefront receipt and canonical Commerce record retained both Size choices, but signed Commerce0.8.0's native Orders inspector displayed two identical product names and catalog IDs without the sizes. This is a merchant packing problem, separate from Commerce262's payment-page display handoff.

The candidate adds one native wrapping Section below each item's facts, using only that item's frozen selection labels. Matching is by catalog item ID, not array position; simple and historical rows without choices stay unchanged. No catalog lookup, persistence, price, permission, payment/Ship contract or completion behavior changes. The signed store plugin is unchanged; local installed proof is not a Registry release or shared deployment.

## Verification · Node24.22.0 / EmDash1.4.0
- `bin/verify-commerce quick`: typecheck,849 unit/workflow tests, repository/feature audits pass.
- `node --test --test-concurrency=1 tests/integration/*.test.mjs`:111 pass in an isolated network namespace.
- Official Registry packaging:129392/131072 backend bytes;1680 headroom. Backend SHA256 `2ffef288f30d7041b67a0de762a0459da2777fc1bcfc333c2e601259497743ee`.
- `NODE_OPTIONS=--max-old-space-size=896 npx playwright test --config=tests/orders-blocks.playwright.config.mjs --grep 'installed Orders lists'`:1 pass. Installed desktop/phone checks show own-line M/L labels with reversed snapshot order, multiple options, full wrapping text/no ellipsis or overflow, unchanged kept order/Checkout storage, and existing authorization/address/complete/reopen behavior.

Harness limits: a shared dependency symlink inflated the bundle; fresh lockfile installation passed. The first installed attempt was stopped after fixture code read a new order's number before the asynchronous page numbered it; the test now waits for its native Inspect button. Isolated-network font metadata is unavailable, but admin rendering and the targeted workflow pass. No unrelated full browser matrix was run. All committed fixtures are synthetic; captures remain ignored under `.tmp/orders-blocks-proof/`, with no merchant/contact/provider records committed.
