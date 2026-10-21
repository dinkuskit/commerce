---
"@dinkuskit/commerce": minor
---

Add a host-only `buildProductPreviewJsonLd` helper for editorial product pages
without a Commerce item. It emits only supplied page facts and never invents
identifiers, price, availability, or an Offer.

Expose existing merchant-approved feed channels on public catalog list and
item responses so storefront hosts can build public feeds without admin
reads. Missing or empty eligibility never opts a product in.
