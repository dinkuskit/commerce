---
"@dinkuskit/commerce": minor
---

The abandoned cart email, like Shopify's abandoned checkout email: a shopper who gives their email at checkout and leaves without paying gets one email 10 hours later, with a link back to the same cart (`/cart/c/<id>?key=<secret>`, a fresh key that lasts as long as the cart). Commerce sends it through the site's EmDash email from the 5-minute background check, and checks again just before sending: no email if the order was paid, the cart was emptied, the setting is Off, or the address stopped cart reminders. At most one per cart. **Commerce settings > Abandoned cart email** picks who gets it: shoppers who ticked the store's unticked "Email me with news and offers" box (the default), all customers, or nobody. `checkout/guest/start` takes `news: true` for the tick, and `checkout/guest/cart` takes `{ stop: true }` from the email's stop link. Commerce asks again for `email:send`, which `0.8.0` already had; no Stripe or Payments change.
