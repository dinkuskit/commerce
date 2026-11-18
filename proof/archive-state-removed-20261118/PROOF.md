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

## Installed upgrade proofs (EmDash 1.4.0 dev site, local Chromium)

`COMMERCE_UPGRADE_FROM=v0.8.0 COMMERCE_UPGRADE_SPEC=registry-upgrade-linked-archive.spec.mjs npm run test:registry-upgrade`: `registry_upgrade=pass from=v0.8.0`. The old phase runs Commerce 0.8.0's own Registry build: a published page sells "Linked cap" (15.00 / 12.00), Hide out-of-stock is saved, then 0.8.0's **Archive product** button archives it while the page stays published. The new phase restarts on this build against the same database and shows:

1. Nothing 0.8.0 stored is rewritten (product with its `archivedAt`, prices, page link, settings); Hide out-of-stock is still on.
2. The accepted change: the product is on the shop again, identical to what 0.8.0 sold before the archive (apart from the member SKU this build adds).
3. The page's panel says **On sale** with 15.00 / 12.00 and has no Archive or Restore buttons.
4. Move to trash: the publish check takes it off sale (`offSale`), keeping id, SKU and page link.
5. Restore from the Trash tab: the page is a Draft; nothing is sold.
6. Publish: the same id, SKU, page and prices are on sale again; prices and settings rows equal 0.8.0's.

| File | Shows |
| --- | --- |
| `upgrade-v0.8.0-old-linked-archived.png` | 0.8.0: Archived: off the shop, page still published |
| `upgrade-v0.8.0-new-linked-on-sale-after-upgrade.png` | This build: On sale, 15.00 / 12.00, no Archive or Restore |
| `upgrade-v0.8.0-new-linked-in-trash.png` | Page in EmDash's Trash tab |
| `upgrade-v0.8.0-new-linked-published.png` | Restored and published: On sale |

`npm run test:registry-upgrade` (default `v0.5.0`): `registry_upgrade=pass from=v0.5.0`. The 0.5.0 store (Red hat on sale, Blue scarf out of stock and hidden) keeps its products, prices, settings and policy rows; the page's next publish check claims Red hat; no archived product is stocked any more. Screenshots: `upgrade-v0.5.0-old-products.png`, `upgrade-v0.5.0-new-settings.png`, `upgrade-v0.5.0-new-panel.png`.
