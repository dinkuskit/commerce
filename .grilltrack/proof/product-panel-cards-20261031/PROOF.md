# Product panel cards and first-Save create: proof

Decisions built: `catalog-panel-cards-20261031` and `catalog-first-save-creates-20261031`
(owner-agreed 31 Oct 2026 in the panel-redesign thread; texts in the PR), on
`catalog-product-needs-page-20261031` and `product-variant-model-20261008`.
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
- Registry bundle: `registry_bundle=pass backend_bytes=130989 headroom_bytes=83`
  (main: 130246, headroom 826).
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
- Screenshots here, from the passing walk: `product-page-unlinked.png` (the
  price form on a new page), `price-stock-saved.png` (cards after saves),
  `product-mobile.png` (phone width), `needs-page-2-new-page-panel.png`,
  `variant-checkout-sandbox.png` (a product with options).

Head at proof time: `8ab920f` plus the proof folder itself.
