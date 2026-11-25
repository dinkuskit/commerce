# Cart key expiry, cart line cap and feed text (deepsec G5-13, G5-05, G5-06, G5-07, G1-11, G1-12)

The owner approved this scope on 2026-11-25. GrillTrack `commerce-cart-key-expiry-20261125`.

`main.txt` and `branch.txt` are the same three test files run on `main` (7806454) and on this branch:
`tests/features/checkout/server-cart.test.mjs`, `tests/features/checkout/cart-left-news.test.mjs` and
`tests/features/feeds/product-feeds.test.mjs`. The checkout tests run Commerce's own guest checkout code against
EmDash's SQLite plugin storage (`PluginStorageRepository`) with the same indexes the plugin declares, so every
key, cart and sweep read and write goes through real storage. Main fails 8 of 41; this branch passes 41 of 41.

What the 8 show:

- **A key lives as long as its cart.** Before a cart is made, a key works for 30 days from `prepare` and is refused
  after. A cart made on day 20 carries its key to day 50. Past the cart's 30 days, the shopper's own key and the
  email's key are both refused; on main the shopper's key kept working forever.
- **The background check deletes keys.** Keys past their date whose cart is gone (never made, or deleted) are
  deleted; a key whose cart still lives moves to the cart's date and is not picked up again until then. On main,
  nothing ever deleted a key.
- **A cart of 101 lines is refused before any catalog read** (0 reads). On main every line was looked up first.
- **Feeds:** a page size that is not a whole number throws instead of returning the same cursor; NUL, vertical
  tab, unit separator, U+FFFF and a lone surrogate are dropped from both feeds, a real emoji is kept, and the next
  product is still in the Google feed.

The storefront already treats a refused key as no cart and asks `prepare` for a new one
(`template-store` `src/features/guest-cart/server-cart.ts`), so a shopper whose cart expired sees an empty cart.
