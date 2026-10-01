# Native Coupons admin v1

This source slice is the coordinator-assigned native React admin surface for
Coupons-v1. It is intentionally unmounted: the central Commerce descriptor,
storage registration, route dispatcher, and manifest remain core-owned and were
not changed here. The canonical proof is
`proof/coupon-admin-native-v1/PROOF.md`; its browser fixture is not
a Registry-installed mount.

## Exported contract for core

The browser-safe native entry is `@dinkuskit/commerce/admin`. It contains
only React pages and the menu declaration. Browser code imports route strings,
types, menu, and the canonical `COMMERCE_PLUGIN_ID` from
`src/admin/coupons-contract.ts`, which re-exports the existing browser-safe
catalog ID (`dinkus-commerce`). It does not import server routes, storage
adapters, route errors, or the domain kernel.

The server-only route adapter is `src/admin/coupons-routes.ts`. A core-owned
composition or supported fixture imports `createCouponAdminRoutes` from the
built `dist/admin/coupons-routes.js` source-relative entry and resolves the
registered `coupons` collection. The production core mount remains pending;
the fixture proof does not claim that the central descriptor or manifest is
mounted.

The composed surface is:

- `pages["/coupons"]` (`CouponsPage`);
- `menu` `{ path: "/coupons", label: "Coupons", icon: "tag" }`;
- `createCouponAdminRoutes(resolve)`, where `resolve(ctx)` returns the
  authoritative `coupons` `CouponCollection`;
- `couponAdminRouteContract`.

The route set is:

| Route | Method | Operation |
| --- | --- | --- |
| `admin/coupons/list` | POST | list coupons and authoritative usage counts |
| `admin/coupons/create` | POST | create a coupon |
| `admin/coupons/edit` | POST | expected-revision CAS edit |
| `admin/coupons/disable` | POST | expected-revision disable |
| `admin/coupons/usage` | POST | authoritative usage counts |

Every route declares `permission: "plugins:manage"`. The host owns permission
enforcement and central registration. The route adapter creates
`createCouponAdmin` and `createCouponAttemptOwner` from the same durable
collection; no second price, usage, or stock writer exists.

## Form behavior

Create supports one code, percentage or fixed USD amount, usage limit, start,
end, and explicit merchant IANA timezone. Fixed amounts are entered in
merchant dollars (`2.50` becomes `250` USD minor units); percentages accept
exact decimal values to two places (`12.5%` becomes `1250` basis points).
No floating-point or second pricing writer is used. Existing values render
losslessly enough to round-trip their stored minor units and basis points.
Date values are entered as ISO timestamps with an explicit UTC offset. Start
is inclusive and end is exclusive. New records use `includeSaleItems: false`
and all-merchandise defaults. Edits preserve eligibility and preserve a
configured percentage maximum while the discount remains percentage.

Runtime route inputs require exact strings, IDs, safe integer revisions, and
known discount kinds. Malformed code, date, cap, field, or kind is an
`INVALID_INPUT`/400 with no write; stale CAS is a `REVISION_CONFLICT`/409 with
the draft retained. The explicit “Reload current and keep draft” action
refreshes the revision before a clerk chooses whether to retry; there is no
silent overwrite.

Disable rejects new acceptance while existing frozen attempts remain intact.

Usage distinguishes consumed redemptions, pending holds, released attempts,
and remaining capacity from `createCouponAttemptOwner.getCounts`.

## Proof boundary

Focused controller/route tests use a neutral real EmDash SQLite storage fixture
in `tests/coupon-admin-native.test.mjs`. The supported fixture in
`tests/native-coupon-site/coupon-plugin.mjs` composes the public SDK, page,
server adapter, and SQLite storage; it does not alter core registration,
descriptors, manifests, or package exports. It is a synthetic supported-host
fixture, not a Registry-installed production mount.

Browser proof command:

`mise exec node@22.23.2 -- npx playwright test --config=tests/coupon-native.playwright.config.mjs`

The repair spec requests ignored artifacts under
`.grilltrack/work/coupon-admin-browser-proof/<run>/`, including empty-before,
percentage and fixed create, usage, disabled-persisted, final-after, and
storage-evidence outputs. The current pinned native run passed 1/1; the
artifact run is `browser-20261001T152159Z`. The current six screenshots and
synthetic storage evidence are published in the immutable release linked from
`proof/coupon-admin-native-v1/PROOF.md`; the current root
`media-manifest.json` records their provenance, redaction review, sizes,
hashes, and URLs. The prior release remains explicitly preserved in
`media-manifest-historical.json`. The exact source/test manifest beside the
proof has identity
`sha256:16b1e96d31fa4cd1abed3851ebea58e1e7657cf9fb249762d49433c650cbb692`,
includes the fixture hygiene file, and excludes docs, ledgers, and proof
recursively. The bounded current composition passed acceptance with 248/248
unit, 22/22 integration, 1/1 native browser, and 3/3 parent real-SQLite
checks. The full pinned composition rail still exited 1 at shared sandbox
startup because Google font metadata/files were unavailable; official CI and
independent review remain pending. The approved composition baseline is
`5710fc185645ed56098aff5727da03483be067ea`, with plan
`15aa3e6cee8cffda9b9fa353a4f0175dd6f79aad82222a6e8190320530ba1ab5`.
This is a supported fixture definition, not Registry publication, hosted
feature merge, deployment, or the pending serial production mount.
