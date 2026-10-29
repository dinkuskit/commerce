# Commerce holds the page-to-product link: Commerce proof

Covers `catalog-page-link-in-commerce-20261029`, which Ronald locked on 29 Oct 2026 at
16:01 UTC. He had typed "123" into a product page's Commerce product box, and the
beta store then hid the product. His view is that an editable box nobody should
type into is bad UI/UX.

Run locally on 29 Oct 2026 with Node 24.22.0 and EmDash 1.2.0, on this branch.

## What changed

- The Dinkus Commerce panel reads only the page `title`, to name a new product.
  It never sends an `editor-draft-patch`, so no "Review proposed changes" dialog
  appears and nothing waits on the page's Save. Commerce no longer asks for
  `admin.editor-draft:patch`. A `commerce_item_id` that an older page still
  carries is never read.
- `catalog-items/set-on-sale` takes `{ entryId, onSale, deleted?, name? }`. A publish
  sells the panel's pick (`e:`), or the page's last sale (`p:`) when there is no
  pick. An unpublish, delete or title-only write acts on what the page last sold
  (`p:`), or the pick when there is none. A page with no link is refused with
  `CATALOG_ITEM_NOT_FOUND`, which the store reads as a plain page. If
  `catalogItemId` is sent, as older templates do, Commerce acts on that product as
  before.
- The private `catalog` route's `get` takes `entryId` in place of
  `catalogItemId` and answers that page's product (the `e:` pick, else the `p:`
  sale), Drafts included. When the page has none it answers `{ product: null }`.
  The store's publish check uses this to tell whether a page sells a product.
- Public catalog products carry `page` (their `pageId`) once a publish check
  records one. `catalog/public/item?pageId=<entryId>` answers the product that
  page's last publish check sold, but only while that product still names the
  page and is on the shop. Otherwise it answers `null`. A request names exactly
  one `itemId` or exactly one `pageId`.
- Commerce still never reads the CMS.

## Registry bundle

`npm run build` gives `registry_bundle=pass backend_bytes=130952 headroom_bytes=120`,
with `backend_sha256=a1e51872fa08c3a7924b4c97de04647a475cacb42c92ed5e56c6c18ef5adfba6`,
on main `19b25b2` (which added #207's 11 bytes), and the same on main `a085bf7`, whose #209 and #212 leave the backend as it was. Main (`04dcf5e`) had 131,033 bytes, 39 free. Removing the draft patch paid for the new
reads, and three changes that cut nothing freed the rest:

- one `productNotFound()` refusal shared by the panels' three not-found checks and
  set-on-sale;
- one `tail()` parser for the panel's action-id tails, used in four places;
- `page` added to the public projection's existing `optionalIds`.

## Unit and integration

- `npm run test:unit` runs 712 tests and 711 pass. The one failure, `native consumer
  smoke teardown … escalates process group to SIGKILL`, also fails on main
  (`04dcf5e`) in this container, which does not deliver process-group signals.
- `tests/features/catalog/product-panel.test.mjs` checks these:
  - Add price and stock and Sell it here link the page without a patch, and their
    toasts are "Draft made. Publish the page to sell it." and "Linked.".
  - Add price and stock on a linked page opens its product and makes nothing new.
  - A `commerce_item_id` naming another product changes nothing.
  - A publish check sent with the page alone sells the panel's pick.
  - An unsaved pick of another product leaves the shop showing what was published.
    Unpublishing takes that product off, and the next publish sells the pick and
    gives the old product up.
  - A title-only write renames what the page sells.
  - A stale pointer is not shown.
  - A deleted page names nothing, and a page with no link is refused as not found.
  - `readPublicCatalogItem(ctx, entryId, true)` and the public catalog's `page`
    agree with all of the above.
- `tests/features/catalog/catalog-api.test.mjs`: `get` by `entryId` answers what
  `get` by id answers, and a page with no product answers `{ product: null }`.
- `tests/features/feeds/public-catalog.test.mjs`, on the native camelCase, native
  snake_case and Registry routes:
  - only a product whose `pageId` matches is found by `pageId`;
  - a mixed `itemId` and `pageId` query, or a repeated or empty one, is refused.
- `tests/features/catalog/public-entry.test.mjs` runs the same checks on the native
  item route.
- The capability lists in `media`, `installed-context` and
  `registry-checkout-services` no longer have `admin.editor-draft:patch`.
- `node --test tests/integration/*.test.mjs` runs 106 tests and all pass. The
  workerd Registry runtime makes a product in the panel with no patch and sells it
  with `{ entryId, onSale: true }`. It lists the product with
  `page: "page-public-hat"`, finds it by `pageId`, answers `null` for another page,
  and refuses a mixed query.

## Browser, real EmDash (`playwright test`, all projects, and the orders config)

All 10 browser specs pass, and so do the 3 orders and packaged-consumer specs.
On the Registry sandbox build:

- Add price and stock answers "Draft made. Publish the page to sell it." with no
  patch and no review dialog.
- `product_pages` holds the page's link while the page's own `commerce_item_id`
  stays empty.
- A reload opens the Draft from Commerce's link.
- Replaying the same press opens the same product, and only one product exists.
- `{ entryId, onSale: true }` puts it on sale.
- The Blue hat page links the same way.

The native variant run makes its product the same way, and native `set-on-sale`
sends the page alone. `native-populated` and the older-store upgrade spec still
make pages with `commerce_item_id`, as older stores have them, and pass.

## Not proven here

- `test:merchant:local` was not run, because it needs a pinned Payments checkout.
- The store template's half is a separate change in dinkuskit/template-store. That
  change takes the field off the product page, reads a page's product through
  `get` by `entryId`, and sends set-on-sale with the page. Until a store has it, a
  page linked only in this panel publishes without going on sale, so the Commerce
  beta and that template change reach a store together.
