---
"@dinkuskit/commerce": patch
---

Shrink the Registry plugin file by 1,457 bytes with no change in behavior.
Shopper accounts, guest checkout and the Inventory Pack button now share one
copy of the same-origin request check and the secret hashing helpers, and the
shopper account handlers, routes and error table are written once instead of
five times.
