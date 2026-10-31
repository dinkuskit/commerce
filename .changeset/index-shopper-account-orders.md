---
"@dinkuskit/commerce": patch
---

Index stored `orders` rows by normalized `emailKey` (`emdash-plugin.jsonc` and `createPlugin()`) so `listOrdersForEmail` queries a shopper's orders by `{ emailKey }` plus a `{ emailKey: null }` fallback for pre-upgrade legacy rows instead of scanning all store orders, and seed the customer profile in `verifyShopperSignIn` before consuming the OTP challenge or persisting the session row.
