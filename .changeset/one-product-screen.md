---
"@dinkuskit/commerce": minor
---

One product screen: each Content > Products page gets a Dinkus Commerce editor panel with price, sale price, SKU, sizes, stock, weight and photos, plus "Make this sellable", which makes a Draft product and links it to the page without saving the page. The Commerce Products page leaves the Registry admin; Commerce settings lists products without a page, each with Make a page. New products start as a Draft (off the shop) until the store's publish check calls the private `catalog-items/set-on-sale` route; restoring an archived product returns it to Draft. Commerce pages sit in a "Dinkus Commerce" sidebar folder, and Settings is labelled "Commerce settings".
