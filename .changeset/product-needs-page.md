---
"@dinkuskit/commerce": minor
---

Every product is made for its page. The catalog API's `create` now requires the page's `entryId` and refuses a page that already sells a product; the `link` op, the panel's "Sell it here" list and the "Products without a page" section in Commerce settings are gone. The CLI's `products create` finds or makes the Content > Products page by slug (`--slug`, default from `--name`), then makes the product for it; `products link` is removed.
