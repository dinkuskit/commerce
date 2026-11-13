---
"@dinkuskit/commerce": patch
---

Send each item's chosen options ("Size: M") with its payment line, the same text the order page shows, so Stripe's payment page tells two sizes of one product apart. Items without options send none. Needs the matching hosted Payments update (dinkuskit/payments#119) deployed first.
