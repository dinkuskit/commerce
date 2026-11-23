---
"@dinkuskit/commerce": patch
---

The Orders page, the private `orders` route's `list` and the Ship sync read kept orders a page at a time through the `paidKey` index instead of reading every order, so a store with more than 10,000 orders still opens Orders (before, the page, the route and the Ship sync stopped with an error past 10,000). The page shows the newest kept order first, 25 a page; `list` stays oldest first, 50 a page. Orders kept before 22 November 2026 have no `paidKey` and list first on the page and last in `list`; an order Completed before `shippedKey` existed lists under `processing` in `list`'s status filter.
