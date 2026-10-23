# One product screen

Locks: `catalog-one-product-screen-20261023`, `catalog-products-page-removed-20261023`,
`catalog-product-states-20261023`, `admin-sidebar-plugin-folders-20261023`.

## Product page panel (Registry build)

`emdash-plugin.jsonc` declares one editor panel, `product`, on the `products`
collection. It is titled "Dinkus Commerce" and served by the private `product-panel` route
(`content:edit_any`, POST). The panel reads the draft fields `title` and
`commerce_item_id` and may patch only `commerce_item_id`; that needs the
`admin.editor-draft:read` and `admin.editor-draft:patch` capabilities.

- A page with no product shows "Make this sellable" with an optional SKU, and,
  when any exist, a list of products without a page ("Sell it here"). The
  list shows 50; typing a product's SKU there reaches every product.
- Make this sellable creates a physical product named from the page title.
  The SKU is the one typed, or one made from the title. The product starts as
  a Draft (`offSale: true`). The panel links the page in `product_pages` and
  returns an `editor-draft-patch` setting `commerce_item_id`. EmDash asks the
  owner to apply it, and the page keeps it only when they press Save.
- A linked page shows the product's name, its state (Draft, On sale or
  Archived) and SKU, then the editor that used to live on the Products page:
  rename, price and sale, stock status, choices, weight, images and Archive or
  Restore.
- The page's own `commerce_item_id` wins over `product_pages`. EmDash sends no
  draft on `panel_load`, so the panel opens from the stored link, and the next
  step the owner takes settles it: a page saved before `product_pages` existed
  gets its link, a page whose id was changed opens that product, and a page
  whose link patch was declined or never saved is offered the patch again.
  Make this sellable on a page that already names a product opens that
  product. The publish check also writes the link.
- The sell form carries its create command in its action id (`sell:<uuid>`),
  and a made-up SKU takes its tail from that command. A retry after a partial
  failure resumes the product the first try made instead of making another.
- The bulk "Apply same price" form is not in the panel, to stay under the
  Registry's 128 KiB backend limit. Each choice keeps its own Save.
- A refused Make this sellable keeps the typed SKU and its buttons.

## Products page removed

The Registry build no longer mounts `/products`. Commerce settings has a
"Products without a page" section that lists up to 25 products no page sells.
Each has a "Make a page" link to `content/products/new`. Archived products
without a page are listed too, marked "(archived)", so they can be given a page
and restored.

Native installs keep their React Products and Store pages, which sit in the
same sidebar group. EmDash 1.2.0 serves no Block Kit editor panel for a plugin
that has a React admin entry (`getPluginEditorExtension` returns null when
`admin.entry` is set), so the native build cannot carry the panel without
moving its admin off React.

## Product states

`offSale` on a catalog item means Draft: public catalog reads, item lookups,
basket quotes and storefront availability treat it like an archived product.
Products made before this flag existed have no `offSale`, so a product whose
page is already published stays on sale. Restoring an archived product
returns it as a Draft from the product page panel; the native Products screen, which has
no page to publish, restores it straight onto the shop.

The store's publish check calls the private route `catalog-items/set-on-sale`
(`content:publish_any`, POST) with:

- `{ catalogItemId, entryId, onSale: true }` when the product page is published;
- `{ catalogItemId, entryId, onSale: false }` when it is unpublished;
- `{ catalogItemId, entryId, onSale: false, deleted: true }` when it is deleted,
  which also drops the page's link.

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
- `p:<entryId>`: the product the page's last publish check sold. Each check
  moves it with one conditional write from the revision it read before
  claiming, so of two overlapping checks for one page only one lands; the
  other gives its product back and is refused.

The page id is required, and the whole request is checked before any write;
a variant member is refused as not found. A product the page no longer sells,
and the product of a deleted page, go back to Draft with no page, but only
while the product still names that page. A page with no recorded product (for
example one published before links existed) claims its product on its next
check, so it can always withdraw it. Commerce never reads the CMS. The store template owns that call.

## Sidebar folders

Commerce pages carry `group: "Dinkus Commerce"`, and Settings is labelled
"Commerce settings". Payments (`Dinkus Payments` > Payment settings) and Ship
(`Dinkus Ship` > Shipments) adopt their folders in their own repositories.
