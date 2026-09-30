# Commerce v1 Inventory availability

- Track `gt-join-edee28c3ffe5d322451dacd0140b8af8`
- Lead decisions remain implemented, not verified:
  `commerce-v1-inventory-unavailable-001`,
  `manage-stock-checkbox-001`, `block-admin-save-001`
- Base `791882e5c44069810de9017fca48383886e5a606`
- Working-tree verification; parent owns commit, push, and draft PR
- Source inventory: `proof/v1-inventory-unavailable-20260930/source-manifest.sha256`
  (all evidence metadata in this proof directory is excluded from the inventory; every other tracked or new public source file is included)
- Manifest identity: `sha256:eec7b502ec531a7eb7c97b764234983e6ebfdbdfb9429713aeecdaf1c0eca69e`

## Acceptance

Partial. Native Commerce keeps the Manage stock slider after Regular/Sale.
Default is gray, disabled, and paired with adjacent Coming soon. Pointer and
keyboard cannot change it. Legacy managed products stay checked. Native UI
discovers `manageStockControl.enabled` from the trusted list route.

Public catalog entry compatibility is restored. Built
`createCatalogItemRoute`, `listCatalogProductsRoute`, and
`saveCatalogProductPricesRoute` are default-disabled `PluginRoute` objects
with defined `handler`. Direct mounts refuse `manageStock: true`. Additive
factories `createCatalogItemRouteWithLocalStock`,
`createListCatalogProductsRouteWithLocalStock`, and
`createSaveCatalogProductPricesRouteWithLocalStock` accept the trusted host
option. `createPlugin` uses those factories.

Only the host-owned constructor option `enableLocalStockManagement: true`
plus a loopback request URL and every present trusted site URL enables the
slider and mounted admission. Trusted site sources are constructor `siteUrl`
and runtime `ctx.site.url`. Both present sources are honored: a local
constructor cannot mask a known public or malformed runtime site, and a
production constructor fails closed even if runtime is local. Missing or
blank runtime may use an explicit trusted constructor URL because current
EmDash leaves `ctx.site.url` empty. Missing both fails closed. Browser
hostname, frontend `NODE_ENV`, URL queries, and request-body overrides fail
closed. Creation still defaults unmanaged. Omitted and same-value
`manageStock` fields preserve stored truth. Future kernel persist and dormant
restoration remain available when admission is on.

Actual opted-in native browser proof passed on a dedicated trusted fixture:
enabled slider in place with no Coming soon, pointer ON then Save persists
`setup-required`, manual status hides, keyboard OFF then Save restores
dormant manual status, reload reflects persisted prices and tracking, and no
provider or quantity access appears. Default-disabled native slider coverage
still passed. The opted-in browser is now a focused package script invoked
from the full verifier after the standard sandbox suite.

Registry/sandbox Block Kit is `NEEDS_HOST_SUPPORT`. Installed
`@emdash-cms/blocks` 0.41.0 `ToggleElement` has no `disabled` field and
`ToggleElementComponent` never forwards `disabled` to Kumo Switch. The current
Coming-soon notice is an honest fallback and does **not** fulfill the
requested Registry slider. A disabled custom FormBlock may still serialize
its initial value; omission is desirable but unproved. The host proposal is a
sketch, not actual host proof. The three lead decisions are not marked
verified. No formal review or v1-ready claim.

## Local-development contract

```js
const siteUrl = "http://127.0.0.1:4321";
emdash({
  siteUrl,
  plugins: [dinkusCommerce({ enableLocalStockManagement: true, siteUrl })],
});
createPlugin({ enableLocalStockManagement: true, siteUrl });
createCatalogItemRouteWithLocalStock({ enableLocalStockManagement: true, siteUrl });
```

Default route objects stay disabled. Loopback hosts: `localhost`,
`127.0.0.1`, or `::1`. Pass the same configured origin the host set as EmDash
`siteUrl` / `EMDASH_SITE_URL` / `SITE_URL`. Plugin `ctx.site.url` may be empty
until the host runtime supplies it. When that runtime URL is present, it is
not replaced by the constructor URL.

Built locality probe after this repair:

```js
isLocalStockManagementEnabled(
  readLocalStockAdmission(
    { enableLocalStockManagement: true, siteUrl: "http://127.0.0.1:4321" },
    {
      request: { url: "http://127.0.0.1:4321/api" },
      site: { url: "https://store.example" },
    },
  ),
) === false
```

## Legacy conflict

Managed products stay managed. Clerks can edit Regular and Sale. Default
mounted create/save refuse enable and refuse managed-to-unmanaged conversion
before writes. Omitted tracking fields preserve claims, bindings, and
fail-closed sellability. A save that fails after `manageStock` was omitted
does not pretend the product is unmanaged; manual status stays hidden.
Constructor/runtime site conflicts refuse create/save tracking changes, keep
list `manageStockControl.enabled` false, and leave refused writes unchanged.

## Unaffected kernels

`createCatalogItem`, `saveCatalogProductPrices`, `setManageStock`, provider
binding, registration claims, Configure Inventory, storefront resolution, and
the native SQLite future-kernel toggling test remain the future contracts.
Direct kernel callers can still persist `manageStock: true`. Checkout stays
unmounted. Inventory physical quantity is not claimed.

## Verification

```text
mise x node@22 -- npm run typecheck
mise x node@22 -- npm run test:unit
mise x node@22 -- npm run audit:repo
COMMERCE_PROOF_PORT=19740 npm run test:sandbox -- --project=native
COMMERCE_LOCAL_STOCK_PORT=19860 npm run test:sandbox:native-local-stock
```

The focused package script is `npm run test:sandbox:native-local-stock`
(`playwright.native-local-stock.config.mjs`). `bin/verify-commerce full`
invokes it after the standard sandbox suite. Quick verifier scope is
unchanged.

Raw logs stay in ignored working output. Counts:

- typecheck: pass
- unit: 172 pass
- audit:repo + audit:features: clean
- default native slider: 2 pass on ports 19740/19742
- opted-in native local-stock: 1 pass on port 19860
- Prior native SQLite kernel toggle and bounded D1 3/3 were not rerun; no
  source change targeted those suites

## Screenshot digests

Synthetic captures only. Media stays in ignored working output.

| File | SHA-256 |
| --- | --- |
| `native-local-stock-enabled.png` | `4df609a8833dffffc28948ab60ef130da0ea7fba8b5c6720739a656b690e5469` |
| `native-local-stock-setup-required.png` | `e11ca24a43a6df1353ff66d07eb32805281cc1803d28130e10e400d85bf46695` |
| `native-local-stock-dormant-restored.png` | `4df609a8833dffffc28948ab60ef130da0ea7fba8b5c6720739a656b690e5469` |
| `native-local-stock-reloaded.png` | `868b1a751d72f6c2dbbeb453495659e2489f081909c535656b09f8494d9830ee` |
| `native-products-populated.png` | `ab1c37545edc6d3ac66ba4c80352187f7b0721443a487bc390669daed39a4228` |

## Bounds

No checkout mount, provider implementation, Payments/Inventory/Ship/Coupons
or TemplateStore mutation, merge, release, deploy, or secret inspection.
Inventory physical quantity is unproved. Formal review and delivery stay
with the parent owner. Registry disabled-slider acceptance stays blocked on
host Block Kit support.

## Parent verification

Parent checked the built public entry: all three existing route-object exports keep `handler`. Independent locality probes pass for conflicting public runtime/constructor URLs, explicit trusted local opt-in, and default refusal. The full source inventory contains 333 files, including current GrillTrack lineage and all new implementation/config/fixture files; all hashes match. PR31 merged at `91560488c5728c0571fab2423f1ece9f08ffcd8d`; this follow-up targets `main` with reviewed `791882e5c44069810de9017fca48383886e5a606` preserved in ancestry. No review result or Registry acceptance is asserted.
