---
"@dinkuskit/commerce": patch
---

Product admin screens no longer fail with "Too many subrequests" once a store has more than a handful of products. The Products list reads only names, and each product screen and its saves read that one product directly, with prices and stock in one batched call, so a screen costs the same few storage calls with 10 products or 1,000, archived products included.
