# Product panel cards and first-Save create: proof

Decisions built: `catalog-panel-cards-20261031` and `catalog-first-save-creates-20261031`
(locked on the owner's words of 31 Oct 2026 in the panel-redesign thread and
recorded in the ledger with this PR; `catalog-simple-product-label-20261027` is
superseded by the first), on `catalog-product-needs-page-20261031` and
`product-variant-model-20261008`.
Base: main at `e482444` (after #241). Node 24.22.0.

## Behaviour

- A Content > Products page with no product opens on its price form (Regular,
  Sale, SKU, Stock status, Physical product, Weight); Save makes the Draft with
  those values through `createProductForPage`, which the catalog API's
  `create` and the CLI's `products create` also call.
- A linked page shows a status grid, Pricing & stock, and the Variants,
  Shipping and Identifiers cards as Block Kit accordions. A simple product's
  Variants card asks for an option name and comma-separated values; each
  variant is then its own card with Regular, Sale, SKU and Stock status. The
  card just saved or refused stays open on the redraw.
- Vocabulary: options, values, variants. API op `option`, CLI `add-option`
  and `--variant`, no aliases.
- After the first ClawSweeper review: a typed SKU is changed before the price,
  so a SKU another product has is refused before anything is saved and the
  refilled form's revision still holds; a variant's derived SKU comes from the
  value's distinct id with room for the suffix; the CLI's `add-option` keeps
  the product's fulfillment; a refused first price shows the generated SKU
  when none was typed; a storage read failure during a Save returns the
  typing in a price form that claims no stock status.
- After the third review: a typed SKU is changed first, fenced on the
  revision the form read (`editProduct` refuses a moved product, never
  retries a lost compare-and-set under a fence, and moves the fence on to the
  revision EmDash returns from a write to the product's own record), and the
  price save that follows is bound to it, so no stale form changes a SKU,
  price, stock status or feed. A variant's refused price carries Commerce's
  reason, and a price form whose values were refused comes back with a fresh
  action id, so a corrected retry after this request's own SKU write saves;
  every other refusal keeps the sent id. Derived variant SKUs are cut on a
  segment boundary; value ids take the first free numbered suffix; the
  read-failure fallback keeps the feed toggles; `products create` exits 1
  with `price_refused` when Commerce refuses the price.
- After the fourth review: a variant's card carries the SKU it showed beside
  the product's revision, and `changeCatalogItemSku` refuses a write when the
  stored SKU is not that one, so a SKU committed on a variant's own record
  before a refused price is safe from other open cards; the fence is checked
  before the typed SKU is normalized, so a stale form is refused as stale
  whatever it typed, and only a price refused after its fence held keeps the
  fresh action id; a derived variant SKU that would equal the product's own
  is cut one character shorter.
- After the fifth review: the panel's SKU change reads once for another
  item holding that SKU instead of proving the unique indexes on every Save
  (eight storage calls), so a SKU-and-price Save fits EmDash's default ten;
  the unique index, which every product creation proves, still refuses a
  racing duplicate, and the catalog API's `sku` op still proves it first.
  `createProductForPage` refuses a digital product's weight before writing.
- Main merged in after #243 (one build, the native-only routes removed):
  main's ledger and events taken and this PR's two decisions and the
  supersession replayed through the CLI; `validate` passes.
- After the sixth review: a request making several variants proves the unique
  indexes once (`createCatalogItem`'s `proven` option after the first
  creation), so Add options costs 16 storage calls plus 2 per new variant, and
  `addCatalogVariantOption` makes at most seven new variants per request,
  refusing more before anything is written.
- Main merged in again after #245 (Registry headroom): ledger replayed the same
  way; #245's shared Block Kit field helpers build this PR's forms and the
  manage-stock notice has its single Registry text.

## Verification on this head

- `npm run typecheck`: clean. `npm run audit:repo`: clean.
- Unit suite (`node --test` over the `test:unit` globs against the built dist):
  867 passed, 2 failed, of which one was a test pattern for shortened panel
  copy, fixed in `75d900e` and passing since, and one is the pre-existing
  `packaged-consumers` teardown SIGKILL that #241 also saw in this container.
- New unit tests: `tests/features/catalog/product-panel-cards.test.mjs` (the
  kernel function with price, stock, fulfillment, weight, retries and
  refusals; the panel's first Save; Add options from comma-separated values;
  per-variant and product SKU changes and their refusals).
- Registry bundle: `registry_bundle=pass backend_bytes=129054 headroom_bytes=2018` (with #245)
  (main: 130246, headroom 826).
- On the head with the third review's fixes: typecheck and audits clean; the
  unit suite 874 passed, 1 failed (the pre-existing `packaged-consumers`
  teardown SIGKILL); five regression tests added (stale forms for a product
  and a variant, a corrected retry after a committed SKU change, segmented
  and colliding derived ids, feed toggles through a read outage, the CLI's
  `price_refused`); all three Playwright lanes against that build, 11 passed (sandbox 6 in 2.9m,
  native 3, native-variant 2).
- On the head with the fourth review's fixes: typecheck and audits clean; the
  unit suite 876 passed, 1 failed (the pre-existing `packaged-consumers`
  teardown SIGKILL); three regression tests added (a variant's SKU
  committed before a refused price against other open cards, an invalid SKU
  on a stale form, a derived SKU that would equal the parent); all three
  Playwright lanes against that build, 11 passed (sandbox 6 in 2.8m, native 3,
  native-variant 2).
- On the merged head (main after #243, with the fifth review's fixes):
  typecheck and audits clean; the unit suite 850 passed, 1 failed (the
  pre-existing `packaged-consumers` teardown SIGKILL; #243 removed the
  native routes' tests); the budget test now changes the SKU in its product
  and variant price saves under the ten-call adapter; all three Playwright
  lanes, 11 passed (sandbox 6 in 2.9m, native 3, native-variant 2).
- Installed Registry build in real workerd (`COMMERCE_BROWSER_PROOF_PROFILE=sandbox`
  Playwright project, Chromium build 1243 aliased for the pinned 1228):
  6 passed (2.8m) on `8ab920f`, after four spec-only fixes for the new
  card layout (`75d900e`, `a0b0ce4`, `2429e5e`, `8ab920f`).
  - `commerce.spec.mjs`: the first Save makes the product from the price
    form, the cards render and open, weight and identifiers save inside their
    cards, a SKU another product has is refused with the typing kept, a
    storage write failure keeps the typing, pictures and the storefront.
  - `product-needs-page.spec.mjs`: the CLI makes a page and its product; a
    new page opens on the price form with Save; no products-without-a-page UI.
  - `variant-checkout.spec.mjs`: Add options from "Small, Large" makes the
    variants with derived SKUs; fulfillment set in Edit options; per-variant
    prices and stock; a stale form is refused with the typing kept in its
    open card; a second option and a third variant; option renames with a
    pending order's frozen selections.
- Screenshots from the passing walk live in dinkuskit/dinkus-pr-assets under
  `commerce/pr-244-c47873b/`, whose README records each file's bytes, SHA-256,
  provenance and redaction status (commit `8aac1b356fa839395a9c53c614c8e2e7fd62fe76`):
  - [product-page-unlinked.png](https://github.com/dinkuskit/dinkus-pr-assets/blob/8aac1b356fa839395a9c53c614c8e2e7fd62fe76/commerce/pr-244-c47873b/product-page-unlinked.png): the price form on a new page.
  - [price-stock-saved.png](https://github.com/dinkuskit/dinkus-pr-assets/blob/8aac1b356fa839395a9c53c614c8e2e7fd62fe76/commerce/pr-244-c47873b/price-stock-saved.png): the cards after saves.
  - [product-mobile.png](https://github.com/dinkuskit/dinkus-pr-assets/blob/8aac1b356fa839395a9c53c614c8e2e7fd62fe76/commerce/pr-244-c47873b/product-mobile.png): phone width.
  - [needs-page-2-new-page-panel.png](https://github.com/dinkuskit/dinkus-pr-assets/blob/8aac1b356fa839395a9c53c614c8e2e7fd62fe76/commerce/pr-244-c47873b/needs-page-2-new-page-panel.png): a fresh page in the page-first walk.
  - [variant-checkout-sandbox.png](https://github.com/dinkuskit/dinkus-pr-assets/blob/8aac1b356fa839395a9c53c614c8e2e7fd62fe76/commerce/pr-244-c47873b/variant-checkout-sandbox.png): a product with options.

Head at proof time: `8ab920f` plus the proof folder itself.
- On the head with #245 merged and the sixth review's fixes: typecheck and
  audits clean; the unit suite 851 passed, 1 failed (the pre-existing
  `packaged-consumers` teardown SIGKILL); the budget test runs Add options
  with eight values, and a refused ninth, under the 32-call adapter; all
  three Playwright lanes, 11 passed (sandbox 6 in 2.8m, native 3,
  native-variant 2).
