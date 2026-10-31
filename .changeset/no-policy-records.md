---
"@dinkuskit/commerce": minor
---

A store's shipping and returns policies are its EmDash pages; Commerce keeps no policy records (GrillTrack `policy-pages-are-content-20261031`, superseding `jsonld-policy-records-059`). Removed: the public `policies/public` route, the `store_shipping_policy` and `store_return_policy` collections (`storeShippingPolicy` and `storeReturnPolicy` on the native entry), and the `@dinkuskit/commerce/features/store-policies` export. Nothing ever wrote them on the Registry build. `buildProductJsonLd` takes no `policies` input and its Offer carries no `shippingDetails` or `hasMerchantReturnPolicy`; `assertProductJsonLdShape` refuses an Offer that does. The Registry backend is 414 bytes smaller (129,126 bytes).
