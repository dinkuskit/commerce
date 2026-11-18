# Commerce keeps no archive mark of its own

Ledger: `commerce-archive-state-removed-20261118`. Base: main b632f03 (after commerce#284).

## Panel states

`COMMERCE_ARCHIVE_PROOF_DIR=proof/archive-state-removed-20261118 npm run test:product-cards` (product-card-state.spec.mjs, the pinned Block Kit renderer) draws the product panel in each state. None of them shows Archive product or Restore, and none says "Archived".

| File | State | Status line |
| --- | --- | --- |
| `1-draft.png` | New product, page not published | Draft: publish to sell it |
| `2-published-on-sale.png` | Page published | On sale |
| `3-page-in-trash.png` | Page moved to the trash | Draft: publish to sell it |
| `4-restored-and-published.png` | Restored from trash, then published | On sale |

## Build and tests (Node 24.22.0)

- `npm run build`: `backend_bytes=130325 headroom_bytes=747 backend_sha256=76f7fe02c4bfdf48c453741d96d83f3e2ccab94b96c8309c99e5253bd4f0d6aa` (main b632f03: 130,719, so 394 bytes freed).
- `npm run test:unit`: 873/873 pass. `npm run test:integration`: 111/111 pass.

## Upgrade behaviour (accepted)

A product archived with the Archive button of Commerce 0.8.0 or older is no longer held off the shop by `archivedAt` after the update. Ronald accepted this on 18 Nov 2026 ("understood please proceed"): there are no real stores to carry over. Trash the product's page to archive it again. The 0.5.0 upgrade proof drops its archived "Old cap" product, and the 0.8.0 linked-archive proof is removed.
