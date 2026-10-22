---
"@dinkuskit/commerce": patch
---

The Registry build leaves out checkout's coupon quoting, reservation and reconciliation, which it cannot reach without a coupon port, freeing about 5.6 KB under the Registry's per-file size limit. A coupon code is refused exactly as before; the native entry keeps every coupon path.
