# Archive is the page's own Move to trash

PR #277 (closes #276) removes Commerce's own Archive product and Restore buttons. An owner archives a product by moving its page to EmDash's trash. The store's publish check takes the product off sale and keeps its link. Restore in the trash brings the page back as a Draft, and publishing it sells the product again. Publishing also clears an archive that Commerce 0.8.0's Archive button stored, so a product archived before the upgrade is not stranded.

## Captures

These are unedited Playwright element screenshots of the real pinned EmDash Block Kit renderer (`@emdash-cms/blocks`), drawing the compiled Commerce product panel (`dist/admin`) over a disposable in-memory catalog (`tests/helpers/product-card-fixture.mjs`). The renderer runs without the admin's stylesheet. Each "publish check" step calls Commerce's `setProductPageOnSale`, which the store's publish check calls on publish, unpublish and trash. The captures come from the last test in `tests/sandbox/product-card-state.spec.mjs`, run with `COMMERCE_ARCHIVE_PROOF_DIR` set. On every capture the test also checks that the panel offers no Archive product or Restore button.

| File | Source | Shows |
| --- | --- | --- |
| `before-main-on-sale.png` | main `85c303d` | An on-sale product's panel with the **Archive product** button at the bottom. |
| `1-draft.png` | this PR | A new product: "Draft: publish to sell it", and no Archive button. |
| `2-published-on-sale.png` | this PR | Page published: "On sale". |
| `3-page-in-trash.png` | this PR | Page moved to the trash: back to "Draft: publish to sell it", still linked. |
| `4-restored-and-published.png` | this PR | Page restored from the trash (as a Draft) and published again: "On sale". |
| `5-archived-on-0.8.0.png` | this PR | The stored record as 0.8.0's Archive button left it (`archivedAt` set): "Archived: off the shop", and no Restore button. |
| `6-archived-page-in-trash.png` | this PR | Its page moved to the trash: the archive stays. |
| `7-archived-then-published.png` | this PR | The page restored and published: "On sale" again, with the same SKU, name and price. |

## Upgrade proof

`tests/features/catalog/product-panel.test.mjs`, "publishing the page sells a product archived by Commerce 0.8.0, and trash or unpublish keep that archive", stores a record in 0.8.0's shape (`archivedAt` set, page linked and published). It shows that unpublishing and trashing keep the archive, that publishing clears it and puts the product back in the public catalog, and that the product keeps its id, SKU, name and page. It fails on the first #277 commit (`e0b8960`), where publishing left `archivedAt` in place, and passes here.

## Installed upgrade proof

`npm run test:registry-upgrade` (`scripts/registry-upgrade-proof.mjs`, from its default `v0.5.0`) runs an older Commerce release's Registry build in the local EmDash 1.4.0 dev site, stocks it through that release's own admin, and restarts on this build against the same database. Its "old" phase archives "Old cap" with that release's own **Archive product** button, which stores `archivedAt`. Step 9 of the "new" phase is added here, and works through the installed admin and routes:

1. It gives "Old cap" a product page. The publish check's off-sale call, which the template sends when a page is trashed or unpublished, leaves the archive (`archivedAt` unchanged) and keeps the cap off the public catalog. The page's Dinkus Commerce panel says "Archived: off the shop" and has no Archive product or Restore button (`upgrade-v0.5.0-archived-cap.png`).
2. The publish check's on-sale call, which the template sends when the page is published, clears `archivedAt`. The cap keeps its id, SKU OLD-CAP, page and stored price row unchanged, and the public catalog lists "Old cap" again. The panel says "On sale" (`upgrade-v0.5.0-published-cap.png`).

The sandbox site has no template, so the proof calls Commerce's `catalog-items/set-on-sale` route directly, as the template's publish check does. That is why EmDash's own Publish box still reads Draft in both captures. Steps 1 to 8 still pass unchanged: every row the earlier release stored is left as it was until the owner acts.

Result: `registry_upgrade=pass from=v0.5.0` (old phase 1 passed, new phase 1 passed), Node 24, Chromium.

## Installed upgrade from the latest release (v0.8.0)

`COMMERCE_UPGRADE_FROM=v0.8.0 COMMERCE_UPGRADE_SPEC=registry-upgrade-linked-archive.spec.mjs npm run test:registry-upgrade` runs `tests/sandbox/registry-upgrade-linked-archive.spec.mjs`. The "old" phase runs Commerce 0.8.0's own Registry build. A "Linked cap" product page's panel makes the product (SKU LINKED-CAP, Regular 15.00, Sale 12.00). The page is published and its publish check puts the cap on sale, and Commerce settings saves "Hide out-of-stock products". Then 0.8.0's own **Archive product** button archives the cap, and its page stays published. That is the #276 state (`upgrade-v0.8.0-1-archived-by-0.8.0.png`: "Archived: off the shop", with a Restore button). The "new" phase restarts on this build against the same database:

1. Every row 0.8.0 stored is unchanged: the product, its price, its page link (`product_pages`) and the settings. The settings switch is still on.
2. The page's panel says "Archived: off the shop" with Regular 15.00 and Sale 12.00, and has no Archive product or Restore button (`upgrade-v0.8.0-2-after-upgrade.png`).
3. EmDash moves the page to the trash (`DELETE /_emdash/api/content/products/{id}`). The publish check's page-only off-sale call keeps the archive, and the cap stays off the public catalog.
4. EmDash's Trash tab lists "Linked cap" (`upgrade-v0.8.0-3-in-trash.png`). Its row menu's **Restore** brings the page back as a Draft, and the cap stays archived.
5. Publishing the page and its on-sale call sell the cap again. It keeps the same id, SKU, page, price row and store settings, and its public catalog entry matches the one it had on 0.8.0 before the archive. The one difference is the variant member SKU this build adds. The panel says "On sale" (`upgrade-v0.8.0-4-restored-and-published.png`).

As in the v0.5.0 proof, the sandbox site has no template, so the spec calls `catalog-items/set-on-sale` the way the template's publish check does.

Result: `registry_upgrade=pass from=v0.8.0` (old phase 1 passed, new phase 1 passed), Node 24, Chromium. The v0.5.0 proof above was re-run on the same head: `registry_upgrade=pass from=v0.5.0`.

## A product left on sale by a stopped publish check

The old Archive button was also the documented way to withdraw a product that a publish check left on sale when it stopped after selling the panel's pick but before moving the page's pointer (commit 8aec268). Now a page-only off-sale or delete check also withdraws the panel's pick when that product still records this page. Trash or unpublish therefore takes it off the shop, and trashing for good gives it back with no page. Unit test: "a check that sold the panel's pick and stopped before moving the pointer: trash or unpublish still takes that pick off the shop". It fails without the change and passes with it. The rarer case, where the editor picks yet another product before that check, is in `docs/implementation/one-product-screen.md`, together with the route call that still withdraws the product.

## Verification

- `npm run typecheck`: clean.
- Unit tests: 863 pass (Node 24).
- `tests/sandbox/product-card-state.spec.mjs`: 5 pass.
- Registry backend: 130,549 of 131,072 bytes, 523 bytes of headroom (main: 130,854).

No real stores run Commerce yet; the only stores are the beta and template test stores.
