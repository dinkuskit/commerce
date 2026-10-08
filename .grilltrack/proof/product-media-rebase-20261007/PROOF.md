# Product media carried onto installed Orders

Request: rebase and push PR57, no merge/deploy.
Base: e2671635c780edd96e39aaea98c12fa965d7ee4c.
Previous remote: 14ab45ffea0b33fba3fb1f2816d1051147c343fe.
Verified product source: d0105c3dd970650dc5e8e8a0c3a77b3239f9bdd9. Subsequent receipt commit changes only ledger/proof.

## Resolution
Only ledger.json and events.jsonl conflicted. Retained main, replayed seven unique product-media decisions through the standard GrillTrack CLI. All 38 main decision objects remain unchanged; six media decisions have fresh verification, imports remain deferred. PREDECESSOR.json retains exact prior decisions, histories and historical reviews. No historical review is claimed for this new composition.

Source and fixtures auto-merged. Resulting admin dispatch, manifest, feature map and exports preserve installed Orders and all media features. Orders controller and checkout/coupon refactoring remain identical to main. Approved media build levers remain. No stacked child PR was open; no pins/provider/deployment/merge changed.

## Fresh validation
Node 22.23.2; locked npm ci --include=optional; NO_PROXY/no_proxy exclude loopback.
bin/verify-commerce full exited 0:
- Typecheck, build, manifest validation and repository/feature audits passed.
- 324 unit/workflow tests passed.
- 39 SQLite/D1/workerd integration tests passed.
- 6 sandbox/native browser tests passed, including media chooser/gallery/placeholder and anonymous storefront srcset.
- 1 native local-stock browser test passed.
- 1 installed coupon/Orders browser test passed, including canonical paid/free orders, read-only inspection, desktop/mobile and denial/recovery.

Pinned official plugin CLI 0.13.3 bundlePlugin accepted without warnings.
Backend: 128497 / 131072 bytes, 2575 bytes margin.
Manifest: 3782 bytes. Tarball: 36301 bytes.
Tarball SHA256: aa456f6bec7dbb070900b8375237f3a6cbfba34977f16bf456c590a230b3d97e.
Backend SHA256: 47c32e8a33f6903884139d9cb57559133da734e241535622b5d659a8220f8cc3.

## Evidence and limits
Fresh media/native captures: .tmp/sandbox-proof/1791420148799/.
Fresh installed Orders/coupon captures: .tmp/coupon-blocks-proof/1791420264520/.
CAPTURES.json records their bytes/digests. Visually inspected media gallery/storefront and Orders desktop/mobile. Solid-color images are deliberately uploaded PNG fixtures; storefront is an unstyled disposable consumer. Curated media will be retained in the PR assets release. Previous media/reviews remain historical.

Native Spark should follow the pushed synchronize event; no duplicate doorbell. Fresh independent review and merge authorization remain separate. No Registry publication, native migration, production deployment or live Stripe acceptance is claimed.
