# Permanent page delete deletes its product within the sandbox budget

Pull request: `dinkuskit/commerce#288`
Decision: `catalog-permanent-delete-20261122` (the owner approved on 2026-11-22)
Base: `origin/main` `86c2c19`

## What changed after review

- **Bounded:** `forgetProduct` deletes each row collection with one `deleteMany` over the product and all its variants, then the variants with one `deleteMany`, then the product item. The cost no longer grows with the number of variants.
- **Fenced:** a permanent delete keeps `pageId` (and a fresh `pageClaim`) on the product and on a stray pick until they are deleted. The existing conditional write in `editProduct` refuses any other page with `PRODUCT_PAGE_CONFLICT` while cleanup runs, so no other page can claim a product halfway through deletion. `forgetProduct` only deletes a product whose `pageId` is still the deleted page.
- **Resumable:** the page's `p:` and `e:` rows are removed only after its products are gone. A delete that stops partway leaves the product held by the page and off the shop, and the same `{entryId, onSale:false, deleted:true}` request finishes it.
- **Claim-fenced release kept:** `release` still gives an old product back only while its claim holds. Interrupted publish checks still leave the pointer for the next check to finish. The only change is that a deleted page no longer releases its product, because that product is deleted.

## Data model

No schema, collection or index change. The delete reads and removes existing records: `catalog_items` (`pageId`, `pageClaim`, `variantProduct.members`) and rows keyed by item id in `catalog_prices`, `catalog_manual_availability`, `catalog_backorder_policies`, `catalog_media` and `product_feed_eligibility`. A store upgraded from 0.8.0 or 0.9 betas has these same records. A product with no `pageId` (one no page sells) is never touched. Orders keep their own copy and are not read or written.

## Tests

- `tests/features/catalog/product-panel.test.mjs`:
  - deleting a page for good deletes its product, every variant and their rows, so the SKU can be used again
  - a permanent delete that stops halfway holds its product until the same request finishes it (row delete throws; another page is refused; the identical request completes; links go last)
  - deleting the biggest product for good stays within the sandbox call budget (50 variants, 5 row collections: 15 storage calls, under Template Store's 32)
- `tests/sandbox/commerce.spec.mjs` (real workerd + SQLite): the Blue hat page's permanent delete removes its product and rows, leaves the Red hat intact, drops it from the public catalog, and a late publish gets 400 "Product not found".

## Results (Node v24.22.0)

- `npm run build`: `registry_bundle=pass backend_bytes=130750 headroom_bytes=322`
- `npx tsc --noEmit`: pass
- `npm run test:unit`: 888/888 pass
- `npm run test:sandbox`: 12/12 pass
