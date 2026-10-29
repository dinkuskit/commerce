# One product screen

Locks: `catalog-one-product-screen-20261023`, `catalog-products-page-removed-20261023`,
`catalog-product-states-20261023`, `admin-sidebar-plugin-folders-20261023`,
`catalog-page-link-in-commerce-20261029`.

## Product page panel (Registry build)

`emdash-plugin.jsonc` declares one editor panel, `product`, on the `products`
collection. It is titled "Dinkus Commerce" and served by the private `product-panel` route
(`content:edit_any`, POST). The panel reads only the draft field `title`, to
name a new product, and never changes the page; that needs the
`admin.editor-draft:read` capability. Commerce holds the link between a page
and its product (`catalog-page-link-in-commerce-20261029`): a product page has
no Commerce product field, so there is nothing on the page to type into or
save. Commerce 0.6.0 also asked for `admin.editor-draft:patch` to fill such a
field; this build no longer does.

- A page with no product shows "Add price and stock" with an optional SKU, and,
  when any exist, a list of products without a page ("Sell it here"). The
  list shows 50; typing a product's SKU there reaches every product.
- Add price and stock creates a physical product named from the page title.
  The SKU is the one typed, or one made from the title. The product starts as
  a Draft (`offSale: true`) in its first write, so a stop before linking never
  leaves it on the shop, and a retry finds that same Draft. The panel links the page in `product_pages`;
  nothing waits on the page's Save.
- A linked page shows the product's name, its state (Draft, On sale or
  Archived) and SKU, then the editor that used to live on the Products page:
  price and sale, stock status, choices, weight and Archive or Restore. It
  has no Name field: the page title is the product's one name
  (`catalog-page-title-is-name-20261026`), set when the page is published.
- A product with no Regular price says "Add a Regular price to sell it" under
  its state line, and a published page's unpriced product reads "Published:
  off the shop", never On sale. A Save that leaves Regular empty answers with
  the same words as an info notice instead of "Product saved"
  (`catalog-unpriced-product-warning-20261027`). A choice product is unpriced
  when none of its choices has a Regular price.
- A product with no choices says "Simple product. Add a choice, like Size, to
  sell it in more than one version." right above Add choices
  (`catalog-simple-product-label-20261027`). The first choice makes it
  variable, with the product itself as the first member.
- Pictures have their own panel, "Product image & gallery"
  (`product-media-panel`, `catalog-media-panel-20261027`). It opens from the
  page's `product_pages` link and needs no draft access; picks, reorders and
  removals go through the same handler as the Dinkus Commerce panel and answer
  with the pictures again. The library's Cancel is `media.open`. A page with no
  product points to the Dinkus Commerce panel.
- The panel opens from the stored link alone. A `commerce_item_id` that an
  older store's page still carries is never read, whatever it says. Add price
  and stock on a linked page opens its product. The publish check also writes
  the link (`p:`, below).
- The sell form carries its create command in its action id (`sell:<uuid>`),
  and a made-up SKU takes its tail from that command. A retry after a partial
  failure resumes the product the first try made instead of making another.
- The bulk "Apply same price" form is not in the panel, to stay under the
  Registry's 128 KiB backend limit. Each choice keeps its own Save.
- A refused Add price and stock keeps the typed SKU and its buttons.

## Catalog API (catalog-api-20261027)

The private `catalog` route (`content:edit_any`, POST) lets any agent or tool
with an EmDash API token do what the product page panels do, one `op` per
request: list, get, create, link, prices, choice, labels, sku, weight,
identifiers, archive, media and feeds. It calls the same catalog functions as the panels, so
it has their checks and answers. `create` makes a physical Draft and only takes
`commandId`, `name` and `sku`; Manage stock stays off. `create` with `entryId` and `link`
write the panel's `e:` link row, and the page's next publish sells that product, so an
agent links a page exactly as the panel does and never sets a page field. `get` with
`entryId` in place of `catalogItemId` answers that page's product (its `e:` pick, else its
`p:` sale), or `product: null`; the store's publish check reads a page's product this way,
Drafts included, where the public item route shows only products on the shop. `sku` changes the SKU through the same
conditional write as the other product edits, keeping the first create
command, and, as `setCatalogItemSku`, only once the store proves its unique
indexes are active; that index refuses a SKU another product has. The
`dinkus-commerce` CLI wraps every op but `labels` (`docs/CLI-SPEC.md`). A write
may carry `expected`, a preview's code (12 hex digits of SHA-256 over the
`get` answer: product, pictures and feed channels); the route rereads the product and refuses the write with
`COMMAND_CONFLICT` when it no longer matches. Its room came from a
build step that cuts nothing: after the literal-sharing step, repeated global
names (`Object`, `Error`, `JSON` and others) and `void 0` are read once into
short bindings, skipping any name the code declares or tests with `typeof`.

## Products page removed

Commerce no longer mounts `/products`. Commerce settings has a
"Products without a page" section that lists up to 25 products no page sells.
Each has a "Make a page" link to `content/products/new`. Archived products
without a page are listed too, marked "(archived)", so they can be given a page
and restored.

## Block Kit only (commerce-admin-block-kit-only-20261024)

Native installs (stores running Commerce from source, such as the playground)
get the same admin as Registry stores: the Orders and Commerce settings pages
and the product page panel, all Block Kit, so the sidebar reads the same
everywhere. Commerce has no React admin entry any more (EmDash 1.2.0 serves no
Block Kit editor panel for a plugin that has one). The native build serves the
same Block Kit handlers over its own storage names (`catalogItems` is also
reachable as `catalog_items`), through the `admin` and `product-panel` routes
with `content:edit_any`.

Removed with it: the React Products, Store and Coupons screens, the
`@dinkuskit/commerce/admin` export, the `react` peer dependency, and the local
Manage stock browser check. Coupon records stay in storage; coupons are built in
dinkuskit/coupons. Local stock comes back with Inventory, in Block Kit.

The panel carries the GTIN, MPN and Brand form the native Products screen had,
for every store (the owner's call, 24 Oct). It runs the identifiers route's own
checks (GS1 check digit, 256 characters) and an empty box clears its field. Its
room in the Registry build came from size work that cuts nothing: native-only
error status tables and the Manage stock write are left out of the Registry
build behind `REGISTRY_BUILD`, the storefront and private routes share one route
shape each, a dead coupon declaration is marked pure, and the literal-sharing
step now also shares destructured property names. DinkusKit Connect only accepts Registry installs, so a native
store's Commerce settings shows a note marked "(DEV)" in place of Connect.

## Product states

`offSale` on a catalog item means Draft: public catalog reads, item lookups,
basket quotes and storefront availability treat it like an archived product.
Products made before this flag existed have no `offSale`, so a product whose
page is already published stays on sale. Restoring an archived product
returns it as a Draft from the product page panel.

The store's publish check calls the private route `catalog-items/set-on-sale`
(`content:publish_any`, POST) with the page alone; Commerce finds its product
(`catalog-page-link-in-commerce-20261029`). A publish sells the panel's pick
(`e:`), else the page's last sale (`p:`). An unpublish, a delete and a
title-only write act on what the page last sold (`p:`), else the panel's pick,
so an unsaved relink never moves what an unpublish takes off. A page Commerce
holds no link for is refused with `CATALOG_ITEM_NOT_FOUND`, which the store
reads as a plain page. A store whose template predates this still sends the
`catalogItemId` it read from the page's own field, and Commerce acts on that
product as before. The bodies:

- `{ entryId, onSale: true, name }` when the product page is
  published, where `name` is the published page title (Add product's name
  rules; a title that breaks them is refused and the product stays a Draft).
  The name is saved in the same conditional write, keeping the first
  `creationPayload`; a store that sends no `name` leaves it as it was;
- `{ entryId, name }` (no `onSale`) when a published page's
  title changed under an overlapping publish: it renames only the product
  this page already sells and never changes its sale state or link, so a
  late title fix cannot put a product back on sale;
- `{ entryId, onSale: false }` when it is unpublished;
- `{ entryId, onSale: false, deleted: true }` when it is deleted, which also
  drops the page's link.

One product has one page, and only the publish check decides which. The
product itself records the page that sells it (`pageId`), and the check
changes that page and the sale state in one conditional write on the product.
A check from any other page is refused there with `PRODUCT_PAGE_CONFLICT` (409
from the native route; a sandboxed route answers 400 with the same reason), so
a page that lost its product, even with a request already in flight, can never
change it again.

`product_pages` holds two kinds of row:

- `e:<entryId>`: the panel's note of the product an editor picked. It reopens
  the panel and keeps the product off "Products without a page", and never
  decides who sells it. An unsaved relink changes only this note, and the
  panel refuses a product another page sells.
- `p:<entryId>`: the product the page's last publish check sold, and the
  claim that check wrote on it. Each check moves it with one conditional
  write from the revision it read before claiming, so of two overlapping
  checks for one page only one lands; the other gives its product back and is
  refused.

The page id is required, and the whole request is checked before any write;
a variant member is refused as not found. Each check writes a fresh claim
(`pageClaim`) on its product. The product the page sold before goes back to
Draft with no page before the pointer moves, and only while the claim that
took it still holds: a newer check by the same page that took it again keeps
it, and a check that stops halfway leaves the pointer unmoved, so the next
check finishes the release. A deleted page's product goes back to Draft in the
same write that removes its page. A page with no recorded product (for
example one published before links existed) claims its product on its next
check, so it can always withdraw it.

Known limits (no page version is sent, so Commerce cannot order two checks
for the same page):

- Two publish checks for the same page that overlap within one request's time
  and name the same product can leave the page's pointer holding a different
  claim from the product; a later move of the page then leaves that product
  with the page instead of giving it back.
- A Worker that stops after putting a new product on sale and before moving
  the pointer leaves that product recorded only on the product; if the page
  then moves elsewhere or is deleted, that product is not given back.

In both cases the product keeps its page record, and another page asking for
it is refused; archiving the product in its panel takes it off the shop.
Ordering checks by the page's version would close both, at the cost of a
template change and bundle room this build does not have. Commerce never reads the CMS. The store template owns that call.

## The link in the public catalog

The storefront and agents read a page's product from Commerce, not from the
page. Each product in `catalog/public` and `catalog/public/item` carries
`page`, the entry id of the page that sells it (its `pageId`), once a publish
check has recorded one. `catalog/public/item?pageId=<entryId>` answers the
product that page's last publish check sold (`p:<entryId>`), and only while
that product still names the page and is on the shop; otherwise `null`. A
request names exactly one `itemId` or exactly one `pageId`. Commerce still
never reads the CMS: the page id is the one its publish check sent.

## Sidebar folders

Commerce pages carry `group: "Dinkus Commerce"`, and Settings is labelled
"Commerce settings". Payments (`Dinkus Payments` > Payment settings) and Ship
(`Dinkus Ship` > Shipments) adopt their folders in their own repositories.
