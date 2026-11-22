# Commerce authority chain: connected-to line and uninstall cancel

Commerce aa4ce03 (built), Commerce main d8d654c for the upgrade, DinkusKit.com Worker from 484d7a2 under its merchant harness with local D1 and KV. Keys are redacted and ids replaced with <id>.

## 1. Connected-to line
- PASS: Commerce connects with its own Connect and the owner's Approve
- PASS: before Payments joins, the line names the business and Commerce (Connected to Acme Goods on DinkusKit, store <id>. DinkusKit plugins on this store: Commerce. To disconnect one, open Your stores at DinkusKit.com.)
- PASS: after Payments joins, the line names both plugins (Connected to Acme Goods on DinkusKit, store <id>. DinkusKit plugins on this store: Commerce and Payments. To disconnect one, open Your stores at DinkusKit.com.)
- PASS: another business's store shows its own business and plugins (Connected to Other Shop on DinkusKit, store <id>. DinkusKit plugins on this store: Commerce. To disconnect one, open Your stores at DinkusKit.com.)
- PASS: Acme's Commerce key cannot get a store:connection pass for the other store (site_mismatch)

## 2. A cancel for another store, or without a key, cancels nothing
  - D1 plugin keys before: Acme [commerce, payments]; Other Shop [commerce]
  - POST /api/store-keys/cancel (Bearer dk_store_[redacted]) {"site_id":"<id>"} → 403 {"error":"site_mismatch"}
- PASS: Acme's Commerce key cannot cancel at the other store
  - POST /api/store-keys/cancel (Bearer dk_store_[redacted]) {"site_id":"<id>"} → 403 {"error":"site_mismatch"}
- PASS: the other store's Commerce key cannot cancel at Acme
  - POST /api/store-keys/cancel (Bearer [pass redacted]) {"site_id":"<id>"} → 401 {"error":"invalid_store_key"}
- PASS: a store:connection pass is not a key and cancels nothing
  - POST /api/store-keys/cancel (no Authorization) {"site_id":"<id>"} → 401 {"error":"invalid_store_key"}
- PASS: no key cancels nothing
  - D1 plugin keys after the refused cancels: Acme [commerce, payments]; Other Shop [commerce]
- PASS: every key is still there
- PASS: and Acme's and the other store's Commerce keys still trade

## 3. Uninstall cancels only Commerce's key
  - GET /api/store-connection (Bearer [pass redacted]) → 200 {"business":"Acme Goods","site_origin":"https://acme-goods.example","plugins":["commerce","payments"]}
- PASS: before the uninstall, Acme's Commerce pass reads the store
  - D1 plugin keys after the uninstall: Acme [payments]; Other Shop [commerce]
- PASS: Acme's Commerce key no longer trades any pass (invalid_store_key)
- PASS: Acme's Payments key still trades its checkout pass
- PASS: the other store's Commerce key still works
- PASS: a page load with the cancelled key leaves the line at the Store ID alone (Connected to DinkusKit.com, store <id>.)
  - GET /api/store-connection (Bearer [pass redacted]) → 401 {"error":"invalid_pass"}
- PASS: the store:connection pass Commerce got before the uninstall reads nothing after it
  - GET /api/store-connection (Bearer [pass redacted]) → 200 {"business":"Acme Goods","site_origin":"https://acme-goods.example","plugins":["payments"]}
- PASS: Payments' pass from before still reads, and no longer lists Commerce

## 4. A reinstall connects again
- PASS: the reinstalled Commerce connects to the same store (same Store ID)
- PASS: and its line names Commerce and Payments again (Connected to Acme Goods on DinkusKit, store <id>. DinkusKit plugins on this store: Commerce and Payments. To disconnect one, open Your stores at DinkusKit.com.)
  - GET /api/store-connection (Bearer [pass redacted]) → 401 {"error":"invalid_pass"}
- PASS: the pass from the cancelled key still reads nothing now that Commerce has a new key

## 5. Upgrade from Commerce main
- PASS: a store connected with Commerce main shows only the Store ID there (Connected to DinkusKit.com, store <id>.)
- PASS: after the upgrade, the same saved connection shows the line (Connected to Upgrade Shop on DinkusKit, store <id>. DinkusKit plugins on this store: Commerce. To disconnect one, open Your stores at DinkusKit.com.)
- PASS: the saved connection is unchanged by the upgrade and the page load
- PASS: its uninstall cancels the key saved by Commerce main

## 6. An owner's Disconnect stops a pass issued before it, also after a new Approve
  - GET /api/store-connection (Bearer [pass redacted]) → 200 {"business":"Acme Goods","site_origin":"https://acme-goods.example","plugins":["commerce","payments"]}
- PASS: before the Disconnect, Payments' pass reads the store
  - the owner presses Disconnect for Payments under Your stores → 303
  - D1 plugin keys after the Disconnect: Acme [commerce]
  - GET /api/store-connection (Bearer [pass redacted]) → 401 {"error":"invalid_pass"}
- PASS: the Payments pass issued before the Disconnect reads nothing after it
  - GET /api/store-connection (Bearer [pass redacted]) → 200 {"business":"Acme Goods","site_origin":"https://acme-goods.example","plugins":["commerce"]}
- PASS: Commerce's pass still reads, listing only Commerce
- PASS: and the line names only Commerce (Connected to Acme Goods on DinkusKit, store <id>. DinkusKit plugins on this store: Commerce. To disconnect one, open Your stores at DinkusKit.com.)
  - GET /api/store-connection (Bearer [pass redacted]) → 401 {"error":"invalid_pass"}
- PASS: after the owner's Approve gives Payments a new key, the old Payments pass still reads nothing
  - GET /api/store-connection (Bearer [pass redacted]) → 200 {"business":"Acme Goods","site_origin":"https://acme-goods.example","plugins":["commerce","payments"]}
- PASS: while a pass from the new key reads both plugins

31 checks passed.
