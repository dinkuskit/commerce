---
"@dinkuskit/commerce": minor
---

The product page title is the product's one name. The store's publish check may send the page title as `name` with `catalog-items/set-on-sale`, and Commerce saves it in the same write that puts the product on sale, so the shop, cart, checkout and new orders show it. The Dinkus Commerce panel no longer has its own Name field and Rename button.

Update the store first: its publish check must send the title (dinkuskit/template-store#158) before it takes this release. A store that takes Commerce first keeps selling and keeps each product's current name until its store code is updated.
