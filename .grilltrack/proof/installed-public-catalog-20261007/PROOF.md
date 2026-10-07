# Installed public catalog — 2026-10-07

Scope: original Commerce sandbox namespace, Products admin and canonical guest checkout. The public GET reader projects only ID/title/SKU, authoritative customer price and shopper availability. It accepts one optional cursor (1–1024 characters), reads 50 storage rows per page and returns no-store. Filtered empty pages retain continuation. There is no alternate catalog, price, stock or order writer.

The installed EmDash 1.2 HTTP/browser profile passed authenticated admin product creation/pricing, anonymous public catalog/cart selection and canonical prepare. With empty shipped grants and unconfigured Payments, start returned PAYMENTS_UNAVAILABLE and wrote no checkout/order aggregate. The disposable unsigned local Registry profile is not publisher/Registry acceptance. Browser screenshot and HTTP catalog envelope are retained in the ignored run packet; visible screenshot inspected.

The compiled workerd/actual SDK fixture starts with no seeded product, uses the admin owner to create/price a sale product, projects it publicly and checks two units (600 minor) minus a 100-minor coupon = 500 minor in the payment request, persistent canonical order and receipt. Replay retains one order/consumed coupon attempt; reopen without seed/config/credential retains the order. Existing response-loss, zero-payable, unavailable configuration, managed-stock and wake tests are preserved. This fixture intercepts synthetic issuer/provider transport; it is not Stripe TEST readiness.

Local verification: focused public catalog/runtime tests 18/18 passed, installed browser 1/1 passed, native local-stock browser 1/1 passed, ordinary sandbox/native browser 5/5 observed passed. Unit/typecheck/public repository and feature audits passed. One full rerun encountered the existing macOS Wrangler/D1 error-envelope masking (internal error rather than named unique-index error); preserved raw output in the ignored packet. A final full rerun is recorded separately, not inferred from these individual results. Required CI and independent reviews remain separate gates.

Sealed Payments Worker 77c6fe70120c962ee482760a2ad308e3f57faaf367e5bba86d74cd13b1eee548 (preserved executable from source 37842220fddb10dc5294af084110cd33804715be; compatibility harness d538a93 leaves Worker unchanged) was attempted with fully intercepted issuer/Stripe transport. It failed at Worker startup with ERR_RUNTIME_FAILURE/internal error in both Template Miniflare 5.20260930.0-alpha and Commerce 5.20260826.0-alpha. No successful immutable Payments chain is claimed. Exact missing evidence: the sealed Worker must start in a functioning supported Miniflare closure, then pass this current admin-created catalog/coupon chain, recovery, restart, one redemption and amount assertions. No dependency or provider activation was broadened to manufacture a pass.

## Artifact and release-size risk

Backend: 131027 / 131072 bytes; SHA-256 f4eb6cf3c8dc06422afec8dcddf2e1482a4f83e0aff1722e855079278d553b02.
Manifest: SHA-256 9de730960ab91ce1857b808b19a8e96ce54046f6289858daff386eccb2ecd628, 3443 bytes; capabilities and allowedHosts remain empty.
Lockfile: SHA-256 865ece395c6ead0ffa60825343780f12c5690d4e27fb38a48674659453705b1f (unchanged).
Build script: SHA-256 ccf41ff2ee91562e69532883b71dc57634ccc6cd8a2c3cc6b78562f8f54dc347 (unchanged).
Runtime Node 22.23.1; EmDash 1.2.0, sandbox-workerd 0.9.3, plugin-cli 0.13.3, Rolldown 1.2.6, Lingui message-utils 5.9.5, Wrangler 4.127.0. Rolldown browser/ESM minify:true and the pinned audited auth transform remain unchanged.

The initial candidate had only 2 bytes headroom. Narrow factoring increased this to 45 bytes. **This remains a material release risk**, not comfortable capacity. Exact source and dependency/build settings must reproduce this hash/size before any release. Further source/dependency changes require remeasurement; any byte over the unchanged cap blocks packaging. Owner decision before promotion: accept this frozen tight-margin artifact or assign a separate bounded size slice. Broad packaging redesign and weaker guards were excluded.

Size work stores plain generated English descriptors once, reconstructs simple interpolation keys only when pinned compiler output exactly round-trips, and factors repeated guest route declarations/errors. Every emitted catalog message is compared to the pinned compiler; unsupported future compact descriptors fail generation rather than changing messages.

## Ownership and boundaries

Repository dinkuskit/commerce; branch codex/installed-public-catalog; baseline f170e201ad4ccb96a7f8b2b20859b4e75a239d56, tree 38416f17f30fe7e96032f5e639f312f2f7543605. Sole implementation owner, one bounded Cursor ACP turn 96da73ba-2d70-4dcb-ac20-9f4a8a94eab4 using advertised Luna Medium. Canonical taskComplete/cleanupReady/complete=true; exact owned worker exit observed, backend history discard unsupported. Parent verified and repaired returned work after cleanup.

No merge, deploy, publication, live activation, real credentials, provider requests or schedules. Template adoption/publication/slugs, Orders UI and Ship remain later slices. Draft PR native admission requires a non-draft PR; no native clearance is inferred from draft dispatch/relay checks. AutoReview P3, native ClawSweeper/security scans and CI are independently adjudicated against the frozen candidate.
