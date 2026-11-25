---
"@dinkuskit/commerce": minor
---

A cart can carry the store's own facts, such as an account to credit. A cart replace on `checkout/guest/cart` accepts `attributes`: at most 10, each key 1 to 40 characters of `a-z`, `0-9`, `_`, `.` and `-` and never starting with `dinkus_` or `_`, each value text of at most 255 characters, the whole bag at most 1,000 bytes as JSON. A replace that names them replaces them all, one that does not keeps them, and a read returns them. Checkout start freezes them onto the order, whichever payment provider the store uses; they are never sent to Payments. The courier's `order.paid` item now carries them as `attributes` (`null` when there are none), so a plugin can credit an account or grant access once an order is stored as paid.
