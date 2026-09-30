# Native admin gate repair proof

Original parent #27: main `51ab023b14490e3bff821e5310dd1c323092df30` → `0d120659d39e859ed4d32224b5981a18029ccb01`.
Original child #28: `0d120659d39e859ed4d32224b5981a18029ccb01` → `6f511ac1243801d44f177ade1a83383086b594ae`.
Changed source identity: SHA-256 `2b50a34ce9da4420d1474cf2256b34e674dc3fc7ff11d89be5ef9e290e3c2d16` of `source-sha256.txt`.
Runtime: Node 22.23.1, EmDash 0.41.0. Data is synthetic local SQLite only.

## Accepted findings and disposition

- P1, #27: lost native descriptor/page registration and `./admin` export. Required fix. Include the existing compatibility commit plus the complete P2 repair in the parent before independent gate qualification. Fresh sandbox remains Block Kit; native camelCase storage is retained, not migrated.
- P2, #28: managed → Manage stock off → explicit Out of stock → one Save drops the selected status. Required fix. Independent pre-fix browser reproduction failed after a 200 response whose payload omitted `stockStatus`; the final-state screenshot showed In stock. The repaired native UI records explicit radio intent and supplies `stockStatus` only when appropriate. No kernel change.
- Prior generic Workerd constraint-message failures were not accepted as product corruption. The current full integration run passes without weakening assertions. Historical message instability is not claimed permanently eliminated.
- Formal review is pending with its assigned owner. These results establish local acceptance evidence, not current formal review or merge clearance.

## Verification

| Check | Result |
| --- | --- |
| Build, manifest validation and sandbox bundle | PASS via unit command |
| `npm run test:unit` | 125 passed, 0 failed |
| Focused product-admin and native SQLite tests | 20 passed, 0 failed |
| `node --test tests/integration/*.test.mjs` | 20 passed, 0 failed, including all 3 unmodified D1 cases |
| `npm run typecheck` | PASS |
| `npm run audit:repo` | PASS |
| `playwright test` | 3 passed, 0 failed: fresh sandbox and two native cases |

The native browser exercises the exact managed-to-unmanaged explicit Out of stock sequence with Regular/Sale in the same request and persisted after reload. It then re-enables management, proves dormant availability is retained, switches products with an unsaved manual choice, disables management without a new choice, and proves the request omits `stockStatus` and restores dormant Out of stock. Clicking the already-selected default is also honored. Synthetic SQLite integration reopens connections between explicit Save, managed enablement and dormant restoration.

Products/Store registration and built admin import remain proven. The combined browser suite retains populated native identities, prices, manual availability and Store settings, verifies edits/reloads and anonymous denial, and retains fresh sandbox creation/replay, price refusal, stock toggles and Store policy.

## Visible evidence and local artifacts

Pre-fix reproduction: `.grilltrack/work/gate-repair-20260930/repro.log` and `repro-final.png`.
Final command logs: `.grilltrack/work/gate-repair-20260930/` (`build.log`, `unit.log`, `focused.log`, `integration.log`, `typecheck.log`, `audit.log`, `browser.log`).
Final screenshots: `.grilltrack/work/native-continuity/screenshots/native-managed-off-explicit-status.png` and `native-managed-off-dormant-restored.png`. Both inspected directly; each shows Out of stock with saved Regular 42.00 and Sale 35.00. Generated DBs/logs/images remain ignored.

## Composition and limits

Preserve history with a same-repository fast-forward so #27 contains both fixes before qualification. #28 may have no remaining diff and must be reported as redundant rather than given manufactured work. No main merge is performed. PR #29 remains separately owned; later composition must preserve native and sandbox exports/builds plus checkout export/tests and reconcile GrillTrack lineage only through its CLI. `FEATURE_MAP.md` and package composition metadata record that prerequisite.

No EmDash 1.0 runtime, Registry discovery/install, live Inventory integration, populated native-to-sandbox migration, deployment, package publication, or main merge is claimed. Earlier proof packets remain evidence at their historical source identities.
