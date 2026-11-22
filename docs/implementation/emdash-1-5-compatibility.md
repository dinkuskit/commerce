# EmDash 1.5 compatibility migration

This migration repins Commerce from EmDash 1.4.0 to the published EmDash
1.5.0 composition (GrillTrack decision `emdash-1-5-compatibility-20261122`).
Checkout, catalog authority, storage, guest routes and capabilities do not
change. No real store runs Commerce yet, so nothing carries a migration shim.

## Current package contract

- `emdash`, `@emdash-cms/auth` and `@emdash-cms/blocks`: `1.5.0`.
- `@emdash-cms/plugin-types`: `0.6.1`.
- `@emdash-cms/plugin-cli`: `0.13.6`.
- `@emdash-cms/sandbox-workerd`: `0.9.7`.
- The runtime peer stays exact: `emdash` `1.5.0`.
- The manifest records the published `emdash@1.5.0` npm integrity:
  `sha512-Cj0cEBvnWZFmOuj6eYE7DWx9ibVybox9M724oPVYo2/yopS+UxAGH39atIikBB8CGZhtoT/Zr20eRWYVoqOBPg==`.

The [EmDash 1.4 compatibility record](./emdash-1-4-compatibility.md) is kept
as version-bound evidence and is not rewritten. Notes elsewhere that describe
EmDash 1.4.0 behaviour are still accurate on 1.5.0 unless this record says
otherwise.

## What 1.5 changes for Commerce

- **Registry bundle:** 130739 bytes, 333 bytes below the 131072-byte file
  cap (130494 on 1.4.0; the 245 bytes are the index-name fix below).
- **Block Kit:** `@emdash-cms/blocks` 1.5.0 changes only chart and button
  rendering. A toggle still has no `disabled` field and plugin pages still
  render no `media_picker`, so Commerce's own image chooser and its
  disabled-slider fallback stay. Button confirmations open in EmDash's new
  dialog design.
- **Unique storage fields (store database step 095).** In 1.4 a declared
  `uniqueIndexes` field was unique across every plugin and collection on the
  store. In 1.5 it is unique only inside the collection that declares it.
  Commerce declares five: `catalog_items` `commandId` and `skuKey`,
  `managed_sku_claims` `claimKey` and `operationId`, and
  `store_inventory_configurations` `configurationKey`. The fix lets another
  plugin, such as Accounts or Reviews, use the same field names without a
  clash.
- **Unique index names (code change).** 1.5 also renames those indexes. 1.4
  called one `uidx_plugin_<plugin>_<collection>_<field>`. 1.5 keeps that name
  only when every part is lowercase with no underscore; otherwise it is
  `uidx_plugin_` plus the first 32 hex digits of the SHA-256 of
  `[plugin, collection, [field]]` as JSON (emdash
  `database/plugin-storage-index-name.ts`), and step 095 renames existing
  indexes. Commerce proves each unique index by reading the index name out of
  the duplicate error, so on a 1.5 store a 1.4 Commerce reports "uniqueness
  unproven" and refuses to add a product. `uniqueIndexNames` in
  `src/shared/unique-index.ts` gives both names and every matcher checks an
  error against them. The published classifiers (`isConfirmedUniqueViolation`,
  `identifyConfirmedUniqueViolation`,
  `identifyManagedSkuRegistrationClaimUniqueViolation`) still answer
  synchronously, so they use a small script SHA-256, since Web Crypto's digest
  only returns a Promise. Commerce's own catalog writes use the Web Crypto
  version (`uniqueIndexNamesAsync`, `findUniqueViolation`) because the script
  digest would not fit the Registry file cap; a test checks both give the same
  names. A store must therefore run this Commerce before it moves to EmDash
  1.5, and the reference article says so.
- **Plugin memory (store database step 092).** Sandboxed `ctx.kv` values move
  to the shared options table. Commerce keeps only short-lived connect-flow
  notes there (`state:connect:<flow>`); the store key and connection live in
  plugin settings, which this step leaves in place.
- **Set-up hooks run on first start.** EmDash now runs `plugin:install` and
  `plugin:activate` for a config-declared sandboxed plugin with no recorded
  state. Commerce's only hook, `plugin:activate`, registers the background
  check and is safe to run again.
- **Store side:** both database steps need a short maintenance window on a
  store that already holds Commerce data (the beta store). That window belongs
  to the template store and the store deploy, not this package.

## Verification

On Node 24.22.0 with the repinned lockfile:

- `npm test`: 885 of 885 pass.
- `npx playwright test`: 12 of 12 pass, and the orders-blocks suite 5 of 5.
- `npm run test:registry-upgrade` from v0.8.0 (linked-archive spec) and from
  v0.5.0 (default spec) pass. The old release now seeds the store on its own
  EmDash (1.4.0 and 1.2.0), since on 1.5 its index matcher cannot prove
  uniqueness. From 0.8.0 the proof also runs this Commerce on EmDash 1.4.0
  ("bridge") before the store's EmDash moves to 1.5.0, the order stores must
  follow, and checks a duplicate SKU is refused under each index name.
- `npm run test:integration`: 113 of 113 pass, including the two-process
  Wrangler/D1 unique-claim proofs.
- `npx tsc --noEmit`, `node scripts/repo-contract.mjs` and
  `node scripts/check-features.mjs` are clean.

This is a local proof. Journeys on the beta store, after the template store
and the beta store move to 1.5.0, are the gate for the next stable release.
