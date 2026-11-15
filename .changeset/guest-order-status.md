---
"@dinkuskit/commerce": minor
---

The shopper's thank-you page can show where the order is now (GrillTrack `commerce-guest-order-status-20261115`, commerce#275). A cart read of a paid order adds `order.status` (`processing` or `completed`) and `order.completed` (`{ at, carrier?, tracking? }` or `null`), read from Orders for the holder of that cart's key only, in the same shape the shopper account's orders use. Reopening an order clears its tracking again. If Orders cannot answer, the receipt is returned without them. `PaidOrderReceiver` gains an optional `status(orderId)`. The Registry backend is 169 bytes larger (130,929 bytes, 143 spare).
