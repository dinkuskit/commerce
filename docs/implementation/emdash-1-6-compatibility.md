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
