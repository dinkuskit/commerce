---
"@dinkuskit/commerce": minor
---

The public catalog now says which items are on sale: a product, or a variant member, whose customer-facing price is its Sale price carries `"onSale": true`, and a Regular price carries no flag. The store sends this to the Coupons plugin so a coupon set to exclude sale items skips them. The Regular price behind a sale stays private.
