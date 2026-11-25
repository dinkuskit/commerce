# EmDash 1.6.0 compatibility

The owner approved the EmDash 1.6 upgrade on 25 Nov 2026. Decision `emdash-1-6-compatibility-20261125`.

## What moves

- Development pins: `emdash`, `@emdash-cms/auth` and `@emdash-cms/blocks` 1.6.0, `@emdash-cms/plugin-cli` 0.13.7,
  `@emdash-cms/sandbox-workerd` 0.9.8. `@emdash-cms/plugin-types` stays 0.6.1 (1.6 did not change it).
- The runtime peer and `dinkuskit.emdashCompatibility` move to exact `emdash` 1.6.0 with its npm integrity
  (`sha512-AbHLzp8g…`).

## What does not move

- Commerce's code. The Registry build (`dist/sandbox/plugin.mjs`, 131,010 bytes, 62 below the cap) and
  `dist/sandbox/index.mjs`, `manifest.json` and `route-manifest.json` are byte-identical to the 1.5.0 build.
- Storage declarations and permissions. 1.6 adds no capabilities or hooks and renames no plugin indexes; its
  one database step, `098_user_last_login`, adds a column to EmDash's own users table.
- Block Kit gaps: 1.6's `renderElement` still returns null for `media_picker`, and `ToggleElementComponent`
  still forwards no `disabled`, so the Commerce-rendered media chooser and the Coming-soon notice stay.

A store can upgrade EmDash from 1.5 to 1.6 and Commerce in either order.

## Test changes 1.6 needed

- `tests/sandbox/product-page.mjs`: on a phone, 1.6 opens the editor's settings from **Show settings**
  instead of a **Settings** button; the helpers accept either.
- `tests/installed-coupon-site/src/middleware.mjs`: 1.6 reloads plugin state only when the
  `emdash:plugins:generation` option moves. The fixture writes its `_plugin_state` row directly, so it now
  bumps that option too, as EmDash's own install path does. Without it the installed runtime never sees the
  plugin and `ensureStorageIndexesSynced` returns false.

## Upgrade proof

`npm run test:registry-upgrade` runs an earlier release, then this build against the same database, and ends on
this checkout's EmDash 1.6.0. Results and pictures are in
[proof/emdash-1-6-20261125](../../proof/emdash-1-6-20261125/PROOF.md). Each run passes:

- From 0.8.0 on its EmDash 1.4.0, with the linked-archive, order-lookup and orders-paging specs: products,
  prices, page links, settings and paid orders stay exactly as 0.8.0 stored them after this build takes over
  (bridge) and after the store's EmDash moves to 1.6.0.
- From 0.5.0 on its EmDash 1.2.0 (default spec): products, settings, policy and native rows are kept on 1.6.0
  and a duplicate SKU is still refused.
- From 0.9.0-beta.5 on its EmDash 1.5.0 (order-lookup spec): Commerce moves first, on 1.5.0, then the store
  moves to 1.6.0; the orders are unchanged, still found, and a lock made on 1.5.0 still holds. This is the
  Commerce-first order of the 1.5-to-1.6 move.
- The EmDash-first order: the template store's upgrade of a filled 1.5.0 store running Commerce 0.9.0-beta.5
  to 1.6.0 found every product, catalog entry, storage row, unique index and the plugin state unchanged
  (template-store #279, `.grilltrack/proof/emdash-1-6-20261125/upgrade-from-1-5-0.md`).

Two upgrade specs compared the public catalog field by field with the earlier release's and had not been run
since the catalog started naming items on sale (`onSale`, commit `d0fdfaf`). They now leave out that flag, as
they already left out each variant member's SKU, and the linked-archive spec checks the flag is set. The
order-lookup spec skips its "no lookup route yet" check when the earlier release already has one.
