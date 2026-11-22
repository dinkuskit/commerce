# Permanent page delete deletes its product within the sandbox budget

Pull request: `dinkuskit/commerce#288`
Decision: `catalog-permanent-delete-20261122` (the owner approved on 2026-11-22)
Base: `origin/main` `1e1d1a1`

## Real store run (workerd + SQLite, `npm run test:sandbox`, 12/12)

The media test in `tests/sandbox/commerce.spec.mjs` drives the real `catalog-items/set-on-sale` route:

1. Before: the shop lists Red hat and Blue hat ([storefront-before-permanent-delete.png](storefront-before-permanent-delete.png)).
2. Competing page: the Blue hat's page asks to delete the Red hat (`{catalogItemId: <red>, entryId: <blue page>, onSale:false, deleted:true}`). Answer 400 "Another page sells this product"; the Red hat's item and its `catalog_media` row are byte-for-byte unchanged.
3. Upgrade data: the Blue hat gets the five older per-product rows a store upgraded from 0.8.0 holds (`catalog_prices`, `catalog_manual_availability`, `catalog_backorder_policies`, `catalog_media`, `product_feed_eligibility`).
4. Delete permanently for the Blue hat's page: answer `{changed:true}`; its item, all five rows and both page links are gone; the Red hat is still unchanged; the public catalog no longer lists BLUE-HAT; a late publish for the deleted page gets 400 "Product not found".
5. After: the shop lists only Red hat ([storefront-after-permanent-delete.png](storefront-after-permanent-delete.png)). Final storage effects: [permanent-delete-storage.json](permanent-delete-storage.json).

## What changed after review

- **Bounded:** `forgetProduct` deletes each row collection with one `deleteMany` over the product and all its variants, then the variants with one `deleteMany`, then the product item. The cost no longer grows with the number of variants.
- **Fenced:** a permanent delete keeps `pageId` (and a fresh `pageClaim`) on the product and on a stray pick until they are deleted. The existing conditional write in `editProduct` refuses any other page with `PRODUCT_PAGE_CONFLICT` while cleanup runs, so no other page can claim a product halfway through deletion. `forgetProduct` only deletes a product whose `pageId` is still the deleted page.
- **Resumable:** the page's `p:` and `e:` rows are removed only after its products are gone. A delete that stops partway leaves the product held by the page and off the shop, and the same `{entryId, onSale:false, deleted:true}` request finishes it. A product the stopped request already deleted counts as done: the retry goes on to the page's other product and its links instead of answering "Product not found".
- **Variants added meanwhile:** the product's own item is deleted with `compareAndDelete` against the revision that was read. A variant appended after that read changes the revision, so the cleanup reads again and deletes the new variant too. A variant add that read the product just before it was deleted is refused, and its new item is deleted when the product is gone, so its SKU stays free.
- **Claim-fenced release kept:** `release` still gives an old product back only while its claim holds. Interrupted publish checks still leave the pointer for the next check to finish. The only change is that a deleted page no longer releases its product, because that product is deleted.

## Data model

No schema, collection or index change. The delete reads and removes existing records: `catalog_items` (`pageId`, `pageClaim`, `variantProduct.members`) and rows keyed by item id in `catalog_prices`, `catalog_manual_availability`, `catalog_backorder_policies`, `catalog_media` and `product_feed_eligibility`. A store upgraded from 0.8.0 or 0.9 betas has these same records. A product with no `pageId` (one no page sells) is never touched. Orders keep their own copy and are not read or written.

## Tests

- `tests/features/catalog/product-panel.test.mjs`:
  - deleting a page for good deletes its product, every variant and their rows, so the SKU can be used again
  - a permanent delete that stops halfway holds its product until the same request finishes it (row delete throws; another page is refused; the identical request completes; links go last)
  - a permanent delete that stopped after deleting one product finishes the rest on the same request (the first product gone, the stray pick still held; and a stop after the last product, before the links)
  - a variant added while its product is deleted for good is deleted too, or refused with nothing left
  - deleting the biggest product for good stays within the sandbox call budget (50 variants, 5 row collections: 15 storage calls, under Template Store's 32)
- `tests/sandbox/commerce.spec.mjs` (real workerd + SQLite): the run above.

## Results (Node v24.22.0)

- `npm run build`: `registry_bundle=pass backend_bytes=130875 headroom_bytes=197`
- `npx tsc --noEmit`: pass
- `npm run test:unit`: 890/890 pass
- `npm run test:sandbox`: 12/12 pass
