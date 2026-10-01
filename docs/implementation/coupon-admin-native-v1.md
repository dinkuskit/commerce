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

The core-owned native entry intentionally exposes only the already mounted
`/products` and `/store` pages. `CouponsPage` remains a named export for a
host that composes the coupon routes and storage in the same fixture or
production mount.

The composed surface is:

- named `CouponsPage` (`/coupons` when explicitly composed);
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
`tests/native-coupon-site/coupon-admin.mjs` explicitly composes the named
`CouponsPage`; `coupon-plugin.mjs` supplies the test-only route/storage fixture
and descriptor. The fixture does not alter core registration,
descriptors, manifests, or package exports. It is a synthetic supported-host
fixture, not a Registry-installed production mount.

Browser proof command:

`mise exec node@22.23.2 -- npx playwright test --config=tests/coupon-native.playwright.config.mjs`

The repair spec requests ignored artifacts under
`.grilltrack/work/coupon-admin-browser-proof/<run>/`, including empty-before,
percentage and fixed create, usage, disabled-persisted, final-after, and
storage-evidence outputs. The repair browser run is recorded under
`.grilltrack/work/coupon-admin-browser-proof/browser-20261001T163500Z/` and
passed 1/1. Its screenshots and SQLite storage evidence are published in the
fresh immutable
[commerce-coupon-admin-c5207970164e release](https://github.com/dinkuskit/dinkus-pr-assets/releases/tag/commerce-coupon-admin-c5207970164e).
The existing immutable media release linked
from `proof/coupon-admin-native-v1/PROOF.md` remains prior-source proof. The
exact repaired source/test manifest beside the proof records the new source
identity `sha256:c5207970164ed4d15aac454617a1cca7a97551e2392f37c23ea39b3a01f4e68b`,
includes the fixture and focused regression, and excludes docs, ledgers, and
proof recursively. The repair passed four focused tests, one native browser
run, build, and typecheck. The prior full CI passed 248 unit tests, 22
integration tests, five standard browser checks, and one native local-stock
browser check; typecheck, build, and audit passed. Fresh CI and both independent
reviews remain pending. The approved composition baseline is
`5710fc185645ed56098aff5727da03483be067ea`, with plan
`15aa3e6cee8cffda9b9fa353a4f0175dd6f79aad82222a6e8190320530ba1ab5`.
This is a supported fixture definition, not Registry publication, hosted
feature merge, deployment, or the pending serial production mount.
