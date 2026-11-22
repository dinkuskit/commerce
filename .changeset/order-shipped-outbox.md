---
"@dinkuskit/commerce": minor
---

New: Commerce tells the store's other plugins when an order ships, for Reviews. The private `courier/outbox` route (POST) answers the store's courier (`@dinkuskit/courier`) with `order.shipped` news: one item per order marked Completed, id `<orderId>:shipped`, with `{ orderId, shippedAt, email, name, lines: [{ productId, productName }] }`, oldest first, once the order has been Completed for a minute. It refuses any signed-in caller. Orders now keep `shippedKey` while Completed, under a new `orders` index; orders Completed before this version are not announced.
