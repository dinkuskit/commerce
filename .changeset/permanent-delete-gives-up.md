---
"@dinkuskit/commerce": patch
---

Deleting a product page for good finishes even when it stops partway. A delete whose product keeps changing underneath it, such as variants added on every read, stops after 4 tries and answers "The product kept changing. Try again." instead of trying again without end. Any permanent delete that stops partway leaves the product off the shop, held by the deleted page, and Commerce's 5-minute background check now finishes it, a few each run, so its SKU can be used again. `catalog_items` gains a `deleting` index for that check. A few API refusals for an unknown or invalid field now say "request body has an invalid field" or "request body must be an object", with the same `INVALID_INPUT` code.
