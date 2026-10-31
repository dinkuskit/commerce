---
"@dinkuskit/commerce": patch
---

A checkout with only digital items no longer pays the flat shipping charge. Its frozen totals record shipping as free, so Payments adds no Shipping line. A basket with at least one physical item (an item with no fulfillment marked counts as physical) keeps the free or flat charge once per checkout, and Free shipping over still applies.
