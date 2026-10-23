# One product screen: Commerce proof

Run locally on 23 Oct 2026 with Node 24.22.0, EmDash 1.2.0, on this branch.

## Registry bundle

`npm run build`: `registry_bundle=pass backend_bytes=130682 headroom_bytes=390` (after the review fixes; 216 after the native Restore fix and the page-conflict check).
`emdash-plugin validate` accepts the editor panel, the page groups and the two
editor-draft capabilities.

## Unit

`node --test` over the `test:unit` globs: 670 tests, 669 pass. The one failure,
`native consumer smoke teardown … escalates process group to SIGKILL`, tests a
process-group signal that this sandboxed container does not deliver. This
change does not touch that script or test.

New `tests/features/catalog/product-panel.test.mjs`:

- the panel refuses to run outside a product page editor;
- an unlinked page offers Make this sellable and lists products without a page;
- Make this sellable makes an unmanaged physical Draft, links the page and
  returns only an `editor-draft-patch` for `commerce_item_id`;
- picking a product without a page links it; a page already holding that id
  gets no patch;
- a refused Make this sellable keeps the typed SKU; a missing product links
  nothing;
- the publish check route puts a product on sale and back to Draft, and a
  deleted page drops its link; bad input is refused;
- Commerce settings lists products without a page with Make a page.

## Browser, real EmDash (`playwright test`, all projects)

10 of 10 pass: sandbox `commerce.spec` (2), `guest-checkout.spec`,
`variant-checkout.spec` (2); native `guest-checkout.spec`,
`native-populated.spec` (2); native-variant `variant-checkout.spec` (2).

On the Registry sandbox build:

- The sidebar shows a "Dinkus Commerce" folder with "Commerce settings" and no
  Products page.
- A Content > Products page opens the Dinkus Commerce panel. Make this
  sellable makes a Draft, and EmDash asks to apply the `commerce_item_id`
  change. The page keeps it only after Save.
- A stale replay of the panel request is refused by EmDash
  (`EDITOR_DRAFT_STALE`) and makes no second product.
- Anonymous calls to `catalog-items/set-on-sale` are refused. The signed-in
  call puts the product on sale.
- A Draft product stays out of the public catalog until that call.
- The existing price, stock, weight, media and choices walks pass inside the
  panel, including storage-refusal recovery and the phone layout.

## Review fixes (upgrade and recovery)

`tests/features/catalog/product-panel.test.mjs` adds: a retried Make this
sellable after a failed link resumes the first product (one product, same
link); a page saved before `product_pages` existed opens its product from
`commerce_item_id`, a changed id opens the new product and leaves the old one
untouched, and a declined or unsaved link is offered again; archived products
without a page stay listed, marked "(archived)", in the panel and in Commerce
settings. The sandbox browser run (10 of 10) saves the editor after applying
the link, as an owner does.
