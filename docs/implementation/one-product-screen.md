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
  when any exist, a list of products without a page ("Sell it here").
- Make this sellable creates a physical product named from the page title.
  The SKU is the one typed, or one made from the title. The product starts as
  a Draft (`offSale: true`). The panel links the page in `product_pages` and
  returns an `editor-draft-patch` setting `commerce_item_id`. EmDash asks the
  owner to apply it, and the page keeps it only when they press Save.
- A linked page shows the product's name, its state (Draft, On sale or
  Archived) and SKU, then the editor that used to live on the Products page:
  rename, price and sale, stock status, choices, weight, images and Archive or
  Restore.
- The bulk "Apply same price" form is not in the panel, to stay under the
  Registry's 128 KiB backend limit. Each choice keeps its own Save.
- A refused Make this sellable keeps the typed SKU and its buttons.

## Products page removed

The Registry build no longer mounts `/products`. Commerce settings has a
"Products without a page" section that lists up to 25 products no page sells.
Each has a "Make a page" link to `content/products/new`. Native installs keep
their React Products and Store pages, which sit in the same sidebar group.

## Product states

`offSale` on a catalog item means Draft: public catalog reads, item lookups,
basket quotes and storefront availability treat it like an archived product.
Products made before this flag existed have no `offSale`, so a product whose
page is already published stays on sale. Restoring an archived product
returns it as a Draft.

The store's publish check calls the private route `catalog-items/set-on-sale`
(`content:publish_any`, POST) with:

- `{ catalogItemId, entryId, onSale: true }` when the product page is published;
- `{ catalogItemId, entryId, onSale: false }` when it is unpublished;
- `{ catalogItemId, entryId, onSale: false, deleted: true }` when it is deleted,
  which also drops the page's link.

Commerce never reads the CMS. The store template owns that call.

## Sidebar folders

Commerce pages carry `group: "Dinkus Commerce"`, and Settings is labelled
"Commerce settings". Payments (`Dinkus Payments` > Payment settings) and Ship
(`Dinkus Ship` > Shipments) adopt their folders in their own repositories.
