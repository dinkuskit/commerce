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

## Verification

- `npm run typecheck`: clean.
- `npm run test:unit`: 862 pass (Node 24).
- `tests/sandbox/product-card-state.spec.mjs`: 5 pass.
- Registry backend: 130,386 of 131,072 bytes, 686 bytes of headroom (main: 130,854).

No real stores run Commerce yet; the only stores are the beta and template test stores.
