# EmDash 1.5.0 proof

Taken 22 Nov 2026 by `npx playwright test` (sandbox suite) on a new EmDash
1.5.0 SQLite store with the Registry build of this branch installed.

1. `1-product-saved-on-1-5.png`: the admin footer reads EmDash v1.5.0. A
   product was created, which runs the unique-index probe that failed with
   "uniqueness unproven" before the index-name fix, and its identifiers saved.
2. `2-storefront-on-1-5.png`: the same store's storefront lists the new
   products with their pictures and the guest checkout form.

3. Upgrade in the documented order (`COMMERCE_UPGRADE_FROM=v0.8.0
   COMMERCE_UPGRADE_SPEC=registry-upgrade-linked-archive.spec.mjs npm run test:registry-upgrade`,
   phases old, bridge, new, one database):
   - `3-upgrade-0-8-0-on-1-4.png`: Commerce 0.8.0 on its own EmDash 1.4.0 makes, prices,
     sells and archives a product.
   - `4-upgrade-new-commerce-on-1-4-duplicate-refused.png`: this Commerce on that same
     EmDash 1.4.0 (footer v1.4.0) keeps every stored row and refuses a second page taking the
     product's SKU, under the 1.4 index name.
   - `5-upgrade-on-1-5-duplicate-refused.png`: the store restarts on EmDash 1.5.0 (footer
     v1.5.0), migration 095 renames the index to the digest name, every stored row is
     unchanged, and the duplicate SKU is still refused.
4. `6-upgrade-from-0-5-0-on-1-5-duplicate-refused.png`: the default proof
   (`npm run test:registry-upgrade`, Commerce 0.5.0 on its own EmDash 1.2.0, then this
   Commerce on 1.5.0) keeps products, settings, policy and native rows and refuses a
   duplicate SKU after the upgrade.

Runs on this branch: `npm test` 887 of 887, `npm run test:integration` 113 of
113, sandbox suite 12 of 12, orders-blocks suite 5 of 5, both Registry upgrade proofs above. Registry backend
130739 bytes, 333 below the cap. See
[the compatibility record](../../docs/implementation/emdash-1-5-compatibility.md).
