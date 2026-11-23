---
"@dinkuskit/commerce": patch
---

Commerce now keeps a payment notice from Payments until Orders has stored the paid order, so a paid order is not lost when Orders is briefly unreachable or refuses it; the next background check tries again. A payment Payments confirms after the checkout ended unpaid now makes the order anyway, with the same items and total, and the order page shows a "Paid after checkout ended" alert so the store can check it can still fill it or refund it by hand. A coupon provider that cannot be reached while a paid order is completed no longer blocks the order.
