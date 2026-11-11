# Order detail rows

Observed while correcting a paid TEST order on backroadbum.com with signed Commerce0.8.0 and EmDash1.4.0: every detail fact shares one text node. Its26 newlines render with normal HTML whitespace, so IDs, payment, status and both addresses become one paragraph at1440px and390px. Independent exact Status and Version rows are absent; the address-correction and hosted Ship sync themselves work.

`detailFields` now emits one wrapping Section per label/value pair. No host CSS, truncating Fields cell, stored record, action, permission, payment or shipping behavior changes. The signed store plugin is unchanged; this is local source/compiled-Registry proof, not a Registry release or deployment.

## Verification · Node24.22.0 / EmDash1.4.0
- `bin/verify-commerce quick`: typecheck,848 unit/workflow tests, repository/feature audits pass.
- `node --test --test-concurrency=1 tests/integration/*.test.mjs`:111 pass in an isolated network namespace.
- Official Registry packaging:129309/131072 backend bytes;1763 bytes headroom. SHA256 `e5240631a4133dfa5cc0655fad8c14f090fea66b37aac2c581da5f0bf0d2fa66`.
- `NODE_OPTIONS=--max-old-space-size=896 npx playwright test --config=tests/orders-blocks.playwright.config.mjs --grep 'installed Orders lists'`:1 pass. The installed test checks separate exact rows, vertical ordering, no ellipsis or overflow at1440/390, then existing address correction, complete/reopen, access denial and frozen-checkout preservation.

Local harness limits: a shared dependency tree exceeded the bundle cap; a fresh lockfile install passed. The combined checks command reached its execution deadline after quick passed; serialized integration passed separately. The first installed run exhausted this host's default Node heap during admin startup; the bounded896MB rerun passed. These were test setup failures, not store incidents; no unrelated full browser matrix was run locally. Synthetic captures remain ignored under `.tmp/orders-blocks-proof/`; no merchant records or screenshots are committed.
