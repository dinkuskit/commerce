---
"@dinkuskit/commerce": minor
---

Record a billing address on every checkout. Checkout contact accepts and requires `billing` (same shape and checks as `delivery`, any country, refused as `BILLING_INVALID`) and freezes it with the order. The Orders detail now shows the customer's email and phone, Ship to and Bill to ("Same as delivery address" when equal, "Not recorded" on older orders). The agents' `orders` route and `dinkus-commerce orders show` return `billTo` and `billToMatchesShipTo`. Storefronts must send `billing`; the template store's checkout form ships with this release.
