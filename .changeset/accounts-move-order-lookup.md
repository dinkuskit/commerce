---
"@dinkuskit/commerce": minor
---

Shopper accounts leave Commerce for their own plugin, DinkusKit Accounts (`dinkus-accounts`). The public `account/sign-in/start`, `account/sign-in/verify`, `account/sign-out`, `account/orders` and `account/profile` routes, the `customers`, `customer_login_codes` and `customer_sessions` storage, the `email:send` capability and the `./features/customers` package entry are gone; no store has shopper accounts yet, so nothing moves.

New: an order lookup, like WooCommerce's Track your order. The public `orders/lookup` route takes `{ orderNumber, email }` from the store's own server page (same-origin write) and answers that one order, or one not-found message that never says which box was wrong. After 5 wrong tries for one email, or for one order number, that box is refused for an hour after its last wrong try. Guess counts keep only a hash of the email and are cleared by the 5-minute background check.
