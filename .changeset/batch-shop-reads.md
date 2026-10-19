---
"@dinkuskit/commerce": patch
---

The shop's product list no longer fails with "Too many subrequests" once a shop has more than a couple of live products. Each page reads prices, stock and photo records for all its products in a few batched calls, and a page stops early once its photos would take more than 16 Media Library reads, with the next cursor picking up at the next product. One product's page reads each record once. The cursor stays opaque; follow it until it is absent, as before.
