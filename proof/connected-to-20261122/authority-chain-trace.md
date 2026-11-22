# Commerce authority chain: connected-to line and uninstall cancel

Commerce 8afcbbb (built), Commerce main 8afcbbb for the upgrade, DinkusKit.com Worker from bb67aac under its merchant harness with local D1 and KV. Keys are redacted and ids replaced with <id>.

## 1. Connected-to line
- PASS: Commerce connects with its own Connect and the owner's Approve
- PASS: before Payments joins, the line names the business and Commerce (Connected to Acme Goods on DinkusKit, store <id>. DinkusKit plugins on this store: Commerce. To disconnect one, open Your stores at DinkusKit.com.)
- PASS: after Payments joins, the line names both plugins (Connected to Acme Goods on DinkusKit, store <id>. DinkusKit plugins on this store: Commerce and Payments. To disconnect one, open Your stores at DinkusKit.com.)
- PASS: another business's store shows its own business and plugins (Connected to Other Shop on DinkusKit, store <id>. DinkusKit plugins on this store: Commerce. To disconnect one, open Your stores at DinkusKit.com.)
- PASS: Acme's Commerce key cannot get a store:connection pass for the other store (site_mismatch)

## 2. Uninstall cancels only Commerce's key
- PASS: Acme's Commerce key no longer trades any pass (invalid_store_key)
- PASS: Acme's Payments key still trades its checkout pass
- PASS: the other store's Commerce key still works
- PASS: a page load with the cancelled key leaves the line at the Store ID alone (Connected to DinkusKit.com, store <id>.)

## 3. A reinstall connects again
- PASS: the reinstalled Commerce connects to the same store (same Store ID)
- PASS: and its line names Commerce and Payments again (Connected to Acme Goods on DinkusKit, store <id>. DinkusKit plugins on this store: Commerce and Payments. To disconnect one, open Your stores at DinkusKit.com.)

## 4. Upgrade from Commerce main
- PASS: a store connected with Commerce main shows only the Store ID there (Connected to DinkusKit.com, store <id>.)
- PASS: after the upgrade, the same saved connection shows the line (Connected to Upgrade Shop on DinkusKit, store <id>. DinkusKit plugins on this store: Commerce. To disconnect one, open Your stores at DinkusKit.com.)
- PASS: the saved connection is unchanged by the upgrade and the page load
- PASS: its uninstall cancels the key saved by Commerce main

15 checks passed.
