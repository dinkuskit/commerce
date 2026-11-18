---
"@dinkuskit/commerce": patch
---

The Registry manifest no longer declares `coupons.dinkuskit.com` while coupons stay deferred; it now allows exactly `dinkuskit.com`, `payments.dinkuskit.com` and `ship.dinkuskit.com` (GrillTrack `commerce-allowed-hosts-20261118`). The Registry listing gains a "What Commerce connects to" section naming each host and saying that installing Commerce makes no outside calls, pressing Connect starts the connection at DinkusKit.com, and Payments and Ship are contacted only once the store is connected. The store-settings permission check no longer bundles `@emdash-cms/auth`: it accepts the Editor and Admin roles directly, the same answer as EmDash's `content:edit_any` rule, and the audited auth build transform is removed. The Registry backend is 210 bytes smaller (130,719 bytes, 353 spare).
