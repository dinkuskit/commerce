---
"@dinkuskit/commerce": minor
---

Hold the shopper's cart on the server. The new public `checkout/guest/cart` route reads the cart or replaces it whole with a version check (and an optional idempotency key), checks every line against the catalog, picks a variant from the chosen option labels, and keeps a cart for 30 days from its last change. Checkout now starts from the saved cart, so `checkout/guest/start` no longer takes `lines`. In the Registry build a cart read is also the payment status check, and the separate `checkout/guest/status` route is gone.
