# Commerce v1 Inventory availability

Commerce v1 does not wait on a production Inventory service. Native admin keeps
the Manage stock slider after Regular and Sale. By default the control is gray,
disabled, and paired with adjacent Coming soon on the same row. Fresh products
stay unmanaged. Mounted create and save refuse tracking changes. Prices and
unmanaged manual availability keep working.

## Local-development setting

The smallest trusted native contract is the host-owned constructor option
already passed through EmDash `PluginDescriptor.options` into `createPlugin`:

```js
import { dinkusCommerce, createPlugin } from "@dinkuskit/commerce";

const siteUrl = "http://127.0.0.1:4321";

// Astro / native host: configure EmDash site URL and pass the same origin
emdash({
  siteUrl,
  plugins: [dinkusCommerce({ enableLocalStockManagement: true, siteUrl })],
});

// Direct native construction
createPlugin({ enableLocalStockManagement: true, siteUrl });
```

Default is false. This is not a merchant settings-schema field, URL query,
browser `NODE_ENV`, hostname check, or request-body override. Native UI reads
`manageStockControl.enabled` from the trusted list route and never enables the
slider from frontend environment or `window.location` alone.

Admission requires all of:

1. The host constructor option `enableLocalStockManagement: true`
2. A trusted loopback request URL (`localhost`, `127.0.0.1`, or `::1`)
3. Every present trusted site URL on the same loopback hosts

Trusted site URL sources are the host constructor `siteUrl` and, when present,
plugin `ctx.site.url`. Honor both. A local constructor URL cannot mask a known
public or malformed runtime site URL. A production constructor URL fails closed
even if the runtime site is local. Missing or blank runtime site URL may use an
explicit trusted constructor URL because current EmDash leaves `ctx.site.url`
empty. Missing both fails closed.

The host must actually configure that site URL and pass the same origin into
Commerce. Set EmDash `emdash({ siteUrl })`, `EMDASH_SITE_URL`, or `SITE_URL`,
and pass that origin as `dinkusCommerce({ siteUrl })` /
`createPlugin({ siteUrl })`. A missing, blank, whitespace-only, malformed, or
non-http(s) present site URL fails closed even when the request is loopback and
the option is true. Browser hostname, URL query, request-body flags, and
frontend environment cannot opt in.

The named public exports `createCatalogItemRoute`, `listCatalogProductsRoute`,
and `saveCatalogProductPricesRoute` remain default-disabled `PluginRoute`
objects with `handler`. Hosts that need the trusted option use the additive
factories `createCatalogItemRouteWithLocalStock`,
`createListCatalogProductsRouteWithLocalStock`, and
`createSaveCatalogProductPricesRouteWithLocalStock`. `createPlugin` uses those
factories. Direct consumers can keep mounting the original route objects.

When the triple is true, mounted create/save keep actual future kernel
behavior, including persist and dormant status restoration. Creation still
defaults unmanaged if `manageStock` is omitted. When any required part is
false, direct toggles are refused before writes or provider contact. Omitted
and same-value `manageStock` fields both preserve the latest stored truth. A
disabled host FormBlock may still serialize its initial value; Commerce must
not assume omission.

## Legacy conflict

Existing managed products stay managed. Clerks can edit Regular and Sale. They
cannot change tracking in the default v1 UI. An omitted `manageStock` field
preserves the stored managed record, claims, and binding byte for byte. An
explicit managed-to-unmanaged value is refused unless local-dev admission is
on. Unavailable-provider lookups stay fail-closed. There is no local quantity
and no silent downgrade.

If a save fails and `manageStock` was omitted, recovery does not pretend the
product is unmanaged. Manual status stays hidden until stored tracking can be
proven. Refusing a save does not change stock data.

## Registry host gate

Installed `@emdash-cms/blocks` 0.41.0 `ToggleElement` has no `disabled` field.
`ToggleElementComponent` never forwards `disabled` to Kumo Switch. Adding
unsupported `disabled: true`, rendering a clickable toggle labeled Coming soon,
or injecting CSS/JS outside the plugin contract would not fulfill the requested
Registry slider.

Current sandbox rendering therefore keeps an honest Coming-soon notice and does
not emit a Manage stock toggle. That fallback does **not** fulfill Bobby's
final requested Registry UI. Acceptance is `NEEDS_HOST_SUPPORT`.

Required host files and local-source proof are recorded in the ignored working
host-dependency proposal. Commerce does not track foreign EmDash source.

## Preserved kernels

`createCatalogItem`, `saveCatalogProductPrices`, `setManageStock`, provider
binding, registration claims, Configure Inventory, and storefront resolution
remain the future contracts. Direct kernel callers can still persist
`manageStock: true`. Only mounted Block Kit and native plugin create/save apply
v1 admission.

## Reproducible verification

Quick scope is unchanged: `bin/verify-commerce quick`.

The durable full verifier runs the opted-in native local-stock browser after the
standard sandbox suite. Run that boundary alone with:

```bash
npm run test:sandbox:native-local-stock
```

That script executes `playwright.native-local-stock.config.mjs`. The full
command remains `bin/verify-commerce full`.
