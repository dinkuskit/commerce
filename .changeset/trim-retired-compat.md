---
"@dinkuskit/commerce": patch
---

Commerce drops three compatibility paths no store uses, to make room for Tax: an attempt frozen with the old exact-1800 payment window (`paymentWindowSeconds`) is refused (`Invalid payment window`) instead of replayed; the retired isolated Ship TEST profile (0.3.0-beta.0 to beta.2) is refused like any other form of it, and Orders no longer reads an order's `shipPin`; and the Registry build leaves out the inventory checkout errors that only a managed-stock item can raise. The Registry backend goes from 131,057 to 130,278 bytes.
