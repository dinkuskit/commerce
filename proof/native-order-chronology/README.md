# Native Orders chronology

Backroad Bum's Registry Commerce 0.8.0 list placed its newest payment fifth, behind older orders (commerce#265). This candidate changes only native list presentation before the 25-row page slice: parsed payment time descending, then short number descending, then exact order ID ascending. Missing or unparseable legacy times follow dated orders. `listOrders`, the private Orders API, numbering, Ship synchronization, frozen records and exact Inspect identities keep their contracts.

## Verification

Node 24.22.2; EmDash 1.4.0; sandbox-workerd 0.9.6; base `0ee0a23a2ec2b4285afc107734333eea493af3a3`.

- `bin/verify-commerce checks`: PASS — typecheck, 850 unit/workflow tests, repository/feature audits, 111 integration tests and Registry builds. Backend 129,447/131,072 bytes (1,625 headroom; +165 bytes from base).
- `npm exec playwright test -- --config=tests/orders-blocks.playwright.config.mjs --grep "latest payment"`: PASS — installed Registry-format artifact, synthetic receiver-admitted history, 1440/390px. Newest visible first; Next/Previous, keyboard Inspect and Back preserve chronology and exact receipt; Orders/numbering/Checkout rows unchanged.
- New unit cases cover sorting across page boundaries, timestamp offsets/equal instants, missing/unparseable legacy times, number/ID ties, unchanged core storage ordering, exact detail/Back, no extra synchronization/writes and malformed history outside the visible page.

Run local checks in a disposable network namespace when another EmDash runner occupies its default port18788. Install native dependencies normally (or rebuild both better-sqlite3 and workerd after an ignore-scripts install); the workerd JavaScript fallback can leave a grandchild behind on shutdown. No test expectation was bypassed in the final canonical checks run. Captures and generated proof databases stay out of git.

The targeted installed proof passes; the unrelated full browser/settings matrix is left to CI, not claimed locally. All fixtures are synthetic. The live signed store plugin remains unchanged; this is not publication or production deployment, and it does not address #258's scan-cost work.

## Review follow-up · November 12

The reference article now documents native ordering, page size and legacy/tie fallback. A fresh Node 24.22.0 `bin/verify-commerce checks` passes all 850 unit/workflow and 111 integration tests, typecheck, audits and Registry limits; backend SHA-256 remains `5fdb717213c5aefa7b575795fa22258b53c15f6e78094d9a287f048de87d989f` (129,447 bytes). At this November 12 checkpoint the ordering policy still required the maintainer's decision; proof did not grant approval or release authority. On November 13 the maintainer recorded owner approval for native-only chronology in [comment 6842689800](https://github.com/dinkuskit/commerce/pull/266#issuecomment-6842689800); API ordering remains separate.

| Requirement / source | Populated and adverse proof | Observed result |
| --- | --- | --- |
| #265: recent payments before native pagination | Same installed-admin test, 26 receiver-admitted synthetic orders with increasing payment dates and an ID that sorts last, on unchanged base 0ee0a23 and candidate | Base renders #1001–#1025 and fails the newest-first assertion; candidate renders #1026–#1002 at 1440/390px. |
| #265: exact Inspect identity and unchanged records | Candidate Next/Previous, keyboard Inspect, Back; compare Orders, numbering and checkout rows | Next has #1001; Inspect opens `zz-chronology-newest` / `receipt-zz-chronology-newest`; Back restores the first page, with all rows unchanged at both widths. |
| Review: inspectable behavior output | Real EmDash 1.4.0 admin, locally installed compiled Registry-format artifact and SQLite, not intercepted UI responses | Test emits `ORDER_CHRONOLOGY_FIRST_PAGE` and `ORDER_CHRONOLOGY_PROOF` from rendered text and attaches JSON; full redacted output is included in PR266. |

The baseline and final candidate run serially in disposable network namespaces. An earlier attempt symlinked dependencies, defeating the path-bound audited auth transform and failing Registry size; a normal independent install resolved that setup error. A concurrent browser attempt was stopped to avoid memory contention, then the final isolated candidate passed. Neither setup attempt touched live records or establishes a serving incident. Browser captures remain ignored; no screenshots, database or raw runner logs are committed by this repair.

## Current-main merge · November 13

Per maintainer comments [6842796695](https://github.com/dinkuskit/commerce/pull/266#issuecomment-6842796695) and [6843760666](https://github.com/dinkuskit/commerce/pull/266#issuecomment-6843760666), this branch merges (does not rebase) main `de4805a`, retaining both frozen-choice and newest-first installed cases. The canonical welcome/empty-shop acceptance runs first, frozen choices second, chronology last. The two reference-article changes are both retained; the chronology case opens the new Order record fold and checks `$1.00` / `Paid` wording. No additional production behavior or API ordering changes are introduced.

Fresh Node 24.22.0 `bin/verify-commerce checks` passes: typecheck, **854 unit/workflow**, **111 integration**, audits and Registry builds, **130,232 / 131,072 backend bytes** (840 headroom), runtime SHA256 `570effc0429df61b544ba8adff31ecfb3d8755a8909957cb62b66ab52bd498fc`. All **three installed Orders cases pass** in a serial disposable network namespace, exercising 1440/390px, canonical authorization/correction/completion, frozen M/L choices, newest-before-pagination, Next/Previous, keyboard Inspect/Back, exact receipt and unchanged storage. The new chronology fixture coexists with four earlier synthetic order numbers: #1030 leads #1029–#1006; the exact selected receipt is `receipt-zz-chronology-newest`. Zero-total wording is also covered by the canonical case and deterministic view tests.

Current-main Before captures and merged-head After captures are hosted outside git with captured runtime output in PR266. Earlier public media and historical evidence are retained. Existing upstream-main proof binaries are inherited unchanged, not new media added by this follow-up. Full browser/settings CI, review, merge, signed release and deployment remain separate; signed Commerce 0.8.0 and live merchant records are unchanged.
