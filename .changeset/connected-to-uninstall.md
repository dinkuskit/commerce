---
"@dinkuskit/commerce": minor
---

Commerce settings now says what the store is connected to: "Connected to <business> on DinkusKit, store <Store ID>. DinkusKit plugins on this store: …". It reads this on a plain page load with a `store:connection` pass at DinkusKit.com's `GET /api/store-connection`, and leaves the line off on any failure. Uninstalling Commerce (a new `plugin:uninstall` hook) sends only Commerce's key to `POST /api/store-keys/cancel`. The store, its Store ID and the other plugins' keys stay. There is no new capability or host.
