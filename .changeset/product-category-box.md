---
"@dinkuskit/commerce": minor
---

Product pages get a **Product category** panel, like Shopify's Category box: a page with no category is offered the closest Shopify Standard Product Taxonomy category to its title and description with a **Use** button, **Search categories** lists matches with a **Use** button each, and saving the page keeps the pick in its `product_category` field. Matches and the saved category's name come from catalog.dinkuskit.com. The Google, Meta and agent feeds send a product's standard category when the host passes `content.standardCategory` (and `content.productType` for the store's own category). Installing or upgrading asks for `admin.editor-draft:patch` (this panel's one field only) and `catalog.dinkuskit.com` as a network host. To make room, the Registry build writes its functions as shorter arrow functions, freeing about 3,800 bytes with no behaviour change.
