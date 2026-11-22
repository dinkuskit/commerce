---
"@dinkuskit/commerce": patch
---

Deleting a product page permanently from EmDash's trash now deletes its product for good, like WooCommerce's Delete Permanently: the product, every variant, and their prices, stock, backorder, photo and feed rows, so the SKU can be used again. Orders keep their own copy of what was bought, and a product another page sells is left alone. Moving the page to the trash still archives the product and keeps it for Restore. No new permission; the store's publish check already tells Commerce about a permanent delete.
