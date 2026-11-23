---
"@dinkuskit/commerce": minor
---

A cart email already waiting, or being tried again, when its shopper presses the stop link is no longer sent. Commerce checks its stop list again at the moment of sending, through EmDash's `email:beforeSend` hook: an email carrying the store's cart stop link to a stopped address is refused with `CART_EMAIL_STOPPED`, so Store emails records it as not sent and never retries. Every other email goes as before. Commerce asks for the new `hooks.email-events:register` permission.
