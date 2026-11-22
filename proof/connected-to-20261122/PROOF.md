# Connected-to line and uninstall cancel (connect-shows-siblings-133, connect-uninstall-cancels-key-134)

Commerce's part of step (b) in DinkusKit.com's `store-connect-order-135`. It uses the
DinkusKit.com routes added by dinkuskit/dinkuskit#145: the `store:connection` pass with
`GET /api/store-connection`, and `POST /api/store-keys/cancel`. Until those are
deployed, the read fails quietly and Settings shows the Store ID alone, as today. The
uninstall cancel then does nothing, and the owner can still Disconnect under Your stores.

## Authority chain against DinkusKit.com's own code

`authority-chain.mjs` runs the built plugin's own entry points against DinkusKit.com's
built Worker from dinkuskit/dinkuskit#145, under that repository's merchant harness with
local D1 and KV. The entry points are Connect and its Check, the `store-proof` route, the
Commerce settings page load, and the `plugin:uninstall` hook from `dist/plugin.js`.
Connect, Approve, token, store passes, the connected-to read and the key cancel are
DinkusKit.com's real routes.

Two things stand in:
- **Transport.** `https://dinkuskit.com` is mapped to the local Worker.
- **Store address.** The receipt comes from the real `store-proof` route of the
  installation that owns that address.

`authority-chain-trace.md` is the run's output (28 checks), against DinkusKit.com at
`905359b` (dinkuskit/dinkuskit#145) and Commerce main `d8d654c` for the upgrade. Each
request to the cancel and read routes is printed with its answer, redacted, and the
Worker's local D1 file is read after each step to show which plugin keys remain.
1. **Connected-to line.** After Commerce's own Connect, the line names the business and
   Commerce. After Payments joins, it names both. Another business's store shows its
   own business. Acme's key cannot get a `store:connection` pass for the other store
   (`site_mismatch`).
2. **Forbidden cancels.** At `POST /api/store-keys/cancel`, Acme's Commerce key with the
   other store's ID, and the other store's key with Acme's ID, both get 403
   `site_mismatch`. A `store:connection` pass in place of a key, and no key at all, get
   401 `invalid_store_key`. D1 still holds every key, and both Commerce keys still trade.
3. **Uninstall.** The uninstall cancels only Commerce's key, which then trades no pass
   (`invalid_store_key`). Acme's Payments key and the other store's Commerce key keep
   working. A page load with the cancelled key shows the Store ID alone. The
   `store:connection` pass Commerce got before the uninstall answers 401 `invalid_pass`
   at `GET /api/store-connection`, while Payments' pass still reads and lists Payments only.
4. **Reinstall.** A reinstalled Commerce connects to the same store, and the line names
   Commerce and Payments again.
5. **Upgrade.** A store connected with Commerce main shows the Store ID line. After the
   upgrade, the same saved connection shows the business line and stays unchanged, and
   the uninstall cancels the key that main saved.
6. **Disconnect.** After the owner disconnects Payments under Your stores, a Payments
   pass issued before it answers 401 `invalid_pass`. Commerce's pass still reads, and the
   line names Commerce only.

The read stops at once because DinkusKit.com's `store:connection` pass names the plugin
whose key traded for it, and the read answers 401 once that plugin has no key
(dinkuskit/dinkuskit#145 at `905359b`).

## Pictures

`render.mjs` draws the built plugin's Settings answer to a page load with EmDash's own
`BlockRenderer` and the admin stylesheet. A stand-in DinkusKit.com answers the read. The
Block Kit JSON sits beside each picture.
- `settings-connected-to.png`: "Connected to Acme Goods on DinkusKit, store …. DinkusKit
  plugins on this store: Commerce, Payments and Ship. To disconnect one, open Your stores
  at DinkusKit.com."
- `settings-read-failed.png`: the read failed, so the page shows "Connected to
  DinkusKit.com, store …" as before.

## Calls

A plain Settings page load makes two more calls (the pass trade and the read). The test
"a Settings page load with the connected line stays within EmDash's default calls, and a
save skips the read" counts at most 8 calls, below EmDash's default of 10. A save, Connect,
Check and the return from Approve skip the read.
