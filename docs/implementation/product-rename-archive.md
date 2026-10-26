# Rename, archive and find a product

Owners can rename a product, archive it (and restore it), and copy its product
ID from the product's admin page. Decisions: `catalog-product-rename-001`,
`catalog-product-archive-001`, `catalog-product-id-visible-001`.

## Behavior

- **Rename.** Superseded for the product page panel by
  `catalog-page-title-is-name-20261026`: the panel has no Name field, and
  publishing the page sets the name from its title (see
  [one-product-screen.md](one-product-screen.md)). The native
  `catalog-items/rename` route stays.
  The name lives on the product's own record, which speaks for each of its
  choices: the Shop card, the cart, checkout and new orders all read it from
  there, so one compare-and-set renames everything at once.
  Paid orders keep the name the product had when it was bought: each order
  line already stores its own name. The name rules are Add product's (1-160
  characters, no control characters). The record's first `creationPayload` is
  kept so a replayed create still matches.
- **Archive.** Archive product (it asks first) marks the product's own record
  `archivedAt`. That product and every choice of it, including a choice added
  later, is off the public catalog and its item lookup, and checkout refuses it,
  because `resolveStorefrontAvailability` and
  `resolveManagedStorefrontAvailability` both answer not listable and not
  sellable after checking the product record. It stays in the Products list marked
  Archived, keeps its id, prices, media and orders, and Restore product puts it
  back as it was. Nothing is deleted.
- **Product ID.** The product page shows the product's id in a box. A product
  page's "Commerce product" field takes this id. In the native admin the box
  has a copy button. The Registry admin shows the same id in a Block Kit code
  block. EmDash 1.2.0 Block Kit has no copy element, so an owner selects the
  id there.
- **Routes (native).** `POST catalog-items/rename {catalogItemId, name}` and
  `POST catalog-items/set-archived {catalogItemId, archived}` need
  `content:edit_any` and answer `{ changed }`. The Registry build adds no route:
  its admin acts through the existing `admin` route.

## How other platforms do it (checked 2026-10-17)

| Platform | Remove | Rename | Past orders |
| --- | --- | --- | --- |
| Shopify (Admin GraphQL 2026-10) | `ProductStatus.ARCHIVED`: "no longer being sold and isn't available to customers"; archived products leave the storefront and the main product list. `productDelete` is "irreversible", and Shopify suggests "archiving or unpublishing products instead if you might need to restore them later" | `Product.title` is "the name for the product that displays to customers" | "The product information in completed orders is preserved" after a delete |
| WooCommerce | Trash: trashed products "are not visible to customers" and can be restored. Delete permanently from Trash "cannot be undone" | The product title is the product page heading | Each order line keeps its own name (`WC_Order_Item::get_name`) beside `product_id` |
| BigCommerce | Visible on storefront (`is_visible`) hides a product. Delete takes effect immediately | Product name | Not stated on the pages checked |
| EmDash 1.2.0 content | Entries go to Trash (`deleted_at`) and can be restored, then permanently deleted | n/a | n/a |

Sources:
[Shopify ProductStatus](https://shopify.dev/docs/api/admin-graphql/latest/enums/ProductStatus),
[Shopify productDelete](https://shopify.dev/docs/api/admin-graphql/latest/mutations/productDelete),
[Shopify Product](https://shopify.dev/docs/api/admin-graphql/latest/objects/Product),
[Shopify product details](https://help.shopify.com/en/manual/products/details/product-details-page),
[WooCommerce duplicate or delete a product](https://woocommerce.com/document/managing-products/duplicate-or-delete-product/),
[WC_Order_Item_Product](https://woocommerce.github.io/code-reference/classes/WC-Order-Item-Product.html),
[BigCommerce delete products](https://docs.bigcommerce.com/developer/api-reference/rest/admin/catalog/products/delete-products).
Gaps: BigCommerce's help pages did not render, and none of the checked pages
says what happens to orders after a BigCommerce or WooCommerce product is
permanently deleted.

**Adopt** archive with restore (Shopify Archived, WooCommerce Trash) and
order lines that keep their own names. **Defer** permanent delete. Orders,
Ship labels, feeds and product pages all point at the id, and Ronald does not
want ordered products deletable. A delete for never-ordered products can come
later as its own decision. **Adapt** Shopify's single title: the Commerce name
is the shopper-facing name and the product page heading
(`block-admin-create-002`). Template Store showing the Commerce name as its
heading is a separate Template Store change.
