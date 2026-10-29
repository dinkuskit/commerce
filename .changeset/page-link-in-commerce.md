---
"@dinkuskit/commerce": minor
---

Commerce keeps the link between a product page and its product, so a product page no longer needs a Commerce product field that people could type into. The Dinkus Commerce panel links the page without filling or saving anything on it, and stops asking for the `admin.editor-draft:patch` permission. `catalog-items/set-on-sale` takes the page alone and finds its product: a publish sells the panel's pick, and an unpublish, delete or title change acts on what the page last sold. The private `catalog` route's `get` takes a page's `entryId` to answer the product that page sells, Drafts included. The public catalog lists each product's `page`, and `catalog/public/item?pageId=` finds the product a published page sells, so a storefront reads the link from Commerce.

Update the store's template with this release. A template that still reads the page's Commerce product field when it publishes keeps selling the pages that have it filled in, but a page linked in this panel would publish without going on sale.
