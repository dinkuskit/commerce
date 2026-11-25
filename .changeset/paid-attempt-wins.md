---
"@dinkuskit/commerce": patch
---

When a late payment completes an earlier checkout try after the shopper already started another one, Commerce now treats the paid try as the current one. The order status shows it as paid, the cart is frozen and cannot be checked out again, and no abandoned-cart email goes out for it.
