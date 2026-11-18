# Commerce keeps no archive mark of its own

Ledger: `commerce-archive-state-removed-20261118`. Base: main 055cd3f (after commerce#284 and #280).

## Panel states

`COMMERCE_ARCHIVE_PROOF_DIR=proof/archive-state-removed-20261118 npm run test:product-cards` (product-card-state.spec.mjs, the pinned Block Kit renderer) draws the product panel in each state. None of them shows Archive product or Restore, and none says "Archived".

| File | State | Status line |
| --- | --- | --- |
| `1-draft.png` | New product, page not published | Draft: publish to sell it |
| `2-published-on-sale.png` | Page published | On sale |
| `3-page-in-trash.png` | Page moved to the trash | Draft: publish to sell it |
| `4-restored-and-published.png` | Restored from trash, then published | On sale |

## Build and tests (Node 24.22.0)

- `npm run build`: `backend_bytes=130439 headroom_bytes=633 backend_sha256=67b34864783fed1e30c4d5f2add0ef7807f170e6f9f94489240378e3bc9b4dab` on main 055cd3f merged in (main alone: 130,833).
- `npm run test:unit`: 875/875 pass. `npm run test:integration`: 112/112 pass.

## Upgrade behaviour (accepted)

A product archived with the Archive button of Commerce 0.8.0 or older is no longer held off the shop by `archivedAt` after the update. Ronald accepted this on 18 Nov 2026 ("understood please proceed"): there are no real stores to carry over. Trash the product's page to archive it again. The 0.5.0 upgrade proof drops its archived "Old cap" product, and the 0.8.0 linked-archive proof is removed.
