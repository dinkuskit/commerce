---
"@dinkuskit/commerce": minor
---

Lay out the Orders detail page for packing, like the big platforms' order pages: the order number, paid time and status, a Test order warning, and the shipping actions come first; then an Items table with each item's frozen choices, quantity and line total; Ship to beside Customer and Bill to as parcel lines; and a Payment table with subtotal, coupon, shipping and total. Order ID, version, receipt, checkout attempt, provider payment and catalog IDs move into an Order record fold. Amounts on the Orders pages read as dollars (`$80.00`), payment reads Paid or Nothing to pay, and times read in UTC. Block Kit only; the agent orders API is unchanged.
