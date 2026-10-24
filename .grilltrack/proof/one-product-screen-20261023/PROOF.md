# One product screen: Commerce proof

Run locally on 23 Oct 2026 with Node 24.22.0, EmDash 1.2.0, on this branch.

## Registry bundle

`npm run build`: `registry_bundle=pass backend_bytes=130682 headroom_bytes=390` (after the review fixes; 13 after round 4; panel and settings copy was shortened to fit).
`emdash-plugin validate` accepts the editor panel, the page groups and the two
editor-draft capabilities.

## Unit

`node --test` over the `test:unit` globs: 670 tests, 669 pass. The one failure,
`native consumer smoke teardown … escalates process group to SIGKILL`, tests a
process-group signal that this sandboxed container does not deliver. This
change does not touch that script or test.

New `tests/features/catalog/product-panel.test.mjs`:

- the panel refuses to run outside a product page editor;
- an unlinked page offers Add price and stock and lists products without a page;
- Add price and stock makes an unmanaged physical Draft, links the page and
  returns only an `editor-draft-patch` for `commerce_item_id`;
- picking a product without a page links it; a page already holding that id
  gets no patch;
- a refused Add price and stock keeps the typed SKU; a missing product links
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

## Review fixes, round 3

One product has one page: `linkProductPage` refuses a product another page
links (`PRODUCT_PAGE_CONFLICT`), so the selling page can always take it off
sale and a second page can never flip it. Unit tests cover the panel refusal,
the selling page withdrawing while another page names the product, and a
typed SKU linking a product past the 50 the list shows. The sandbox browser
run posts `set-on-sale` from a competing page id for publish, unpublish and
delete against the real EmDash runtime: each is refused with the conflict
reason, the product stays on sale and `product_pages` keeps only its page.

## Review fixes, round 4

`product_pages` is keyed by product id with a conditional claim; panel links
stay unconfirmed until the publish check confirms them. Unit tests cover a
page published before links existed withdrawing its product after another page
linked it in the panel, two simultaneous claims where only one lands, and
refused publish checks (bad `onSale`, missing product) leaving the links
unchanged. Sandbox: 10 of 10 pass (the variant-checkout walk failed once on
"Add variant" timing and passed on a re-run).

## Review fixes, round 5

The panel and the publish check no longer share ownership. A panel link is a
note (`e:<entryId>`); the row keyed by product id is written only by the
publish check, which now requires the page id and refuses variant members
before any write. Cleanup removes a row only through `compareAndDelete` on the
revision it re-read. Unit tests cover: a page id is required; a variant member
changes nothing; two simultaneous publish checks where only one lands; an
unsaved relink keeping the selling page's row; a stale cleanup leaving another
page's row alone; a page published before links existed claiming its product
while another page only noted it. Unit 680 of 681 (the native-consumer
teardown signal test this container cannot run), integration 105 of 105,
Playwright 10 of 10 (the sandbox walk now expects only the owner row after the
publish check). Registry backend 131059 bytes, 13 bytes under the limit.

## Review fixes, round 6

The page that sells a product now lives on the product (`pageId`), changed in
the same conditional write as its sale state, so a stale request from a page
that lost the product is refused at the write that would change it. Each
page's pointer (`p:<entryId>`) moves by revision, so the later of two
overlapping checks for one page gives its product back instead of deleting the
other check's link. A product a page gives up goes back to Draft with no page.
Unit tests cover a delayed unpublish and delete after reassignment (refused,
product unchanged), overlapping checks for one page, two pages claiming at
once, and an unsaved relink. The sandbox walk now proves reassignment against
the real EmDash runtime through the production route: the page is deleted
(product Draft, no page), a second page takes the product, the first page's
delayed unpublish is refused with the conflict reason, and the product keeps
the second page and stays on sale. Unit 681 of 682 (the native-consumer
teardown signal test this container cannot run), integration 105 of 105,
Playwright 10 of 10. Registry backend 131020 bytes, 52 bytes under the limit
(the panel's new-Draft write now reuses the product edit helper).

## Review fixes, round 7

Each publish check writes a fresh claim on its product (`pageClaim`, kept in
the page's pointer too). Giving the old product back is conditional on that
claim, so an old check can never release a product a newer check by the same
page took again, and it happens before the pointer moves, so a check that
stops halfway is finished by the next one. Unit tests cover both (a newer
check retaking the product mid-release keeps it on sale; a check stopped
before its release leaves the pointer unmoved and the next check releases the
old product). Unit 683 of 684 (the native-consumer teardown signal test),
integration 105 of 105, Playwright 10 of 10. Registry backend 131070 bytes,
2 bytes under the limit.

## Block Kit only (commerce-admin-block-kit-only-20261024)

Ronald, 24 Oct: remove the React admin and use Block Kit for dev and Registry
stores alike. The native plugin now declares the same Orders and Commerce
settings pages and the product page panel, with no admin entry and the two
editor-draft capabilities, and serves them through the same Block Kit handlers
over native storage (camelCase collections are also reachable by their
Registry names; the panel proves catalog uniqueness against the install's own
index). The React Products, Store and Coupons screens, the `./admin` export,
the `react` peer dependency, the coupon admin sources and tests, and the local
Manage stock browser check are removed; coupon records stay in storage.

The native Playwright walk now seeds old native data, links a page saved
before the panel existed by its SKU, edits price and stock in the panel, checks
Commerce settings (seeded hide setting, "Products without a page" listing the
managed blanket), and confirms storage keeps the native collection names. The
native-variant walk builds choices in the panel, publishes the page through the
set-on-sale route, and buys a variant on the native storefront. Unit 667 of 668
(the native-consumer teardown signal test this container cannot run),
integration 105 of 105, Playwright 10 of 10, merchant settings 2 of 2
(registry and native). Registry backend 131025 bytes, 47 bytes under the limit.

## GTIN, MPN and Brand in the panel (owner's call, 24 Oct)

The panel gains the GTIN, MPN and Brand form for every store, with the
identifiers route's checks. Room came only from size work that removes no
feature: native-only error status tables and the Manage stock write leave the
Registry build behind `REGISTRY_BUILD` (the Registry never reads `status` and
already refused Manage stock first), the public reads and private POST routes
share one route shape each, a dead coupon storage declaration is marked pure,
and literal sharing covers destructured property names (new semantics test).
The sandbox walk saves, refuses a bad check digit and clears a field; the
native walk saves on old native data; a refused form keeps what was typed.
Unit 668 of 669 (the native-consumer teardown signal test), integration 105
of 105, Playwright 10 of 10, merchant settings 2 of 2. Registry backend 131054
bytes, 18 bytes under the limit.


## Draft in the first write (review fix, 24 Oct)

Add price and stock now writes the new product as a Draft in its first save
(`createCatalogItem` takes `offSale`), instead of saving it on sale and then
turning it into a Draft, so a stop between the two can no longer leave a
product on the shop. A retry finds that same Draft. The panel test checks the
first catalog write carries `offSale: true` and that a resumed product is
still a Draft. Unit 668 of 669 (the native-consumer teardown signal test),
integration 105 of 105, Playwright 10 of 10, merchant settings 2 of 2.
Registry backend 131050 bytes, 22 bytes under the limit (the fix is smaller
than the extra write it replaces).

## Registry upgrade from 0.5.0 (owner chose "prove it locally first", 24 Oct)

`npm run test:registry-upgrade` (`scripts/registry-upgrade-proof.mjs`, after `npm run build`) builds the v0.5.0 tag's Registry bundle in a temporary worktree, starts the sandboxed proof site on it, and stocks the store through 0.5.0's own Block Kit admin: Red hat (12.00, sale 10.00, in stock, 6 oz), Blue scarf (18.00, out of stock), Old cap (9.00, archived), "Hide out-of-stock products" on, and a Content > Products page for Red hat with `commerce_item_id`. It then restarts the same site on this build against the same SQLite database and checks:

- every `catalog_items`, `catalog_prices`, `catalog_manual_availability`, `storefront_out_of_stock_listing`, `managed_sku_claims` and storefront settings row is byte-for-byte what 0.5.0 wrote, with no `offSale` or `pageId` added and no `product_pages` rows;
- the public catalog answers exactly what it did on 0.5.0 (Red hat on sale; the hidden and archived products off);
- Commerce settings keeps the toggle and lists Blue scarf and "Old cap (archived)" under Products without a page;
- the old page links Red hat by SKU in the panel, shows 12.00 / 10.00 / In stock / On sale, and a panel price edit reaches storage;
- the page's first publish check records it as seller with no change for shoppers (`changed: false`), another page is refused with "Another page sells this product", and unpublishing takes Red hat off the shop;
- the products no page sells are left exactly as they were.

Run 24 Oct 16:38 UTC: `registry_upgrade=pass from=v0.5.0`, both phases passed. The 0.5.0 snapshot and screenshots are in `registry-upgrade/`. 0.5.0's settings save redraws its DinkusKit Connect status after saving, which can fail offline, so the proof checks the stored toggle rather than that toast.
