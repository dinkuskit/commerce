# DinkusKit Commerce

DinkusKit Commerce is the open-source commerce layer for EmDash sites. It is
being built in public for stores whose humans want to orchestrate the business
through EmDash while agents handle repeatable operations through the same
explicit contracts.

## Kit direction

The canonical [vision](https://github.com/dinkuskit/.github/blob/main/VISION.md)
and [roadmap](https://github.com/dinkuskit/.github/blob/main/ROADMAP.md) put a
human-operable EmDash store first. Commerce and Inventory are crucial launch
pieces and launch side by side. This repository's contracts and status below
describe its own scope; the roadmap is not a claim of release readiness.

## Status

Pilot stage. The package name is reserved in source as
`@dinkuskit/commerce`, but the manifest remains private at `0.0.0`: there is
no published package, Registry listing, release, or deployment yet. A local
Registry-format sandbox artifact is built from `emdash-plugin.jsonc` and
`src/plugin.ts`; it is not a claim of public Registry installation.

Development and the private package's runtime peer are pinned to exact
`emdash@0.41.0`. The first feature is the `dinkus.catalog` draft-item creation
pilot, registered under the EmDash runtime slug `dinkus-commerce`. It refuses
writes unless the live EmDash storage collection proves unique `commandId`
and site-wide canonical `skuKey` constraints.

The `dinkus.inventory-provider` foundation now gives Commerce one opaque
store-binding value—provider reference, pool ID, and default fulfillment
location ID—and pure managed-stock state transitions. A catalog item created
with `manageStock: true` is persisted as `managed` and `setup-required`, with
no Commerce-local quantity. Its provider-neutral registration contract then
builds a pool-scoped identity request from the canonical Commerce SKU and uses
the current Commerce title once as the new Inventory display-name default,
falling back to the SKU when the title is absent. Commerce persists one hidden
registration operation before calling its provider port. Ambiguous failures
remain `setup-pending` and are retried only through an explicit action with the
same operation identity; terminal provider rejection becomes
`setup-needs-attention`, and corrected submission requires a new identity. A
newly registered SKU stores only its permanent Inventory identity; an existing
pooled SKU remains `needs-review` until explicit confirmation. Legacy or
malformed managed records fail safe to `setup-required` on read. Live Inventory
transport, current-stock review, pool discovery, and admin UI remain later
slices.

The `dinkus.inventory-setup` slice persists one store-level provider binding
with a permanent Commerce-generated site ID. Its private Configure Inventory
route accepts only a catalog item ID, loads the canonical product and binding
server-side, and starts the existing atomic registration flow through an
injected `InventoryProviderPort`. Missing store setup returns a structured
Configure Inventory action without contacting a provider or creating a claim.
Provider or pool changes require a future explicit migration; they never
silently repoint managed products.

The `dinkus.storefront-availability` backend resolves an active managed
product into stable `status`, `sellable`, and optional `displayQuantity`
facts. Commerce reads only Inventory's authoritative `available` quantity at
the store's configured default fulfillment location. Status-only display is
the compatibility default; store owners may opt into exact quantities or a
positive low-stock threshold. Backorders are a separate per-product policy
that defaults off. Missing setup, missing stock, malformed provider output, or
an unavailable provider returns `availability-unavailable` and is never
treated as zero stock or a backorder. The package stores no fallback quantity.

Products with Manage Stock disabled use a separate Commerce-owned manual
availability value: `in-stock`, `out-of-stock`, or
`available-on-backorder`. A missing value defaults to `in-stock` for new and
legacy products. The private `catalog-items/set-manual-availability` action
can change it only while the product is unmanaged. The value remains dormant
while Inventory manages the product and returns if management is later
disabled. `resolveStorefrontAvailability` selects the managed or unmanaged
authority and always returns the same structured storefront contract;
unmanaged products never expose an invented quantity or contact Inventory.

Catalog products persist an isolated Regular price and optional Sale as Money
`{ currency: "USD", minor }`. Missing Regular is not listable and is never
`$0`. An explicit `$0` Regular is a free product that may appear on the
storefront. Sale requires Regular and must be strictly lower; invalid Sale is
refused rather than silently cleared. `resolveStorefrontAvailability` returns
`listable: false` when Regular is missing.

The sandboxed EmDash Block Kit Products page lists those catalog products by name and
lets a clerk add one with a name and SKU. Name is the customer-facing title
(the product page H1 contract); this plugin does not render a storefront page.
Opening a product shows Regular, Sale, the Manage stock slider, and In stock /
Out of stock / On backorder when the product is unmanaged. Native admin keeps
that slider in place after Regular/Sale. By default it is gray, disabled, and
labeled Coming soon on the same row; keyboard and pointer cannot change it.
Those three stock statuses stay hidden on managed products. New products stay
unmanaged and do not need Inventory. Existing managed products stay managed:
clerks can edit prices, but omitted tracking fields preserve claims, bindings,
and fail-closed sellability. A host enables synthetic local testing only with
`dinkusCommerce({ enableLocalStockManagement: true, siteUrl })` or
`createPlugin({ enableLocalStockManagement: true, siteUrl })` together with an
actual loopback site URL (`emdash({ siteUrl })`, `EMDASH_SITE_URL`, or
`SITE_URL`) and a loopback request. Pass that same configured origin into
Commerce. When runtime `ctx.site.url` is also present, both trusted site URLs
must be loopback; a local constructor cannot mask a public runtime site.
Missing or blank runtime may use the constructor URL. Missing, blank, or
malformed present site URL fails closed.
That is not a merchant setting, URL query, or browser override. The
kernel still accepts future Manage stock transitions. Mounted create/save
refuse tracking changes unless that local-dev triple is true; creation still
defaults off. The public `createCatalogItemRoute`, `listCatalogProductsRoute`,
and `saveCatalogProductPricesRoute` exports stay default-disabled route
objects. Additive `*WithLocalStock` factories configure a trusted host. Registry/sandbox Block Kit 0.41.0 cannot render a true disabled
slider, so the Coming-soon notice there is a temporary fallback pending host
support. Commerce still stores Money.
Commerce → Settings → Catalog lets the shop owner show out-of-stock products on the
live site or hide them. The default is to show them. Hide is opt-in and
applies to clerk Out of stock and Inventory-at-zero. On backorder stays
visible. Unpriced products stay hidden. Admin still lists every product.

Mounted-site work is currently a private pilot backed by the public
[`saariuslystoned/emdash`](https://github.com/saariuslystoned/emdash) fork, not
a stock 0.41.0 compatibility claim. It requires exact commit
`4c1f21900f3a28e9a270e64111f4979bce74926e`, the public head of
[EmDash PR #2768](https://github.com/emdash-cms/emdash/pull/2768). Stock
`emdash@0.41.0` cannot materialize the required indexes through the mounted
Cloudflare development runtime, so Commerce fails writes closed there. After
the fix reaches a stable EmDash release, Commerce must repin and rerun the
SmokyClub mounted-site proof before expanding its compatibility claim.

The current product boundary is recorded in [docs/CHARTER.md](docs/CHARTER.md).

## Sandbox distribution

`npm run build` produces `dist/sandbox/{plugin.mjs,manifest.json,index.mjs}`
with the released EmDash plugin CLI. The publisher is `@smokyco.bsky.social`;
publication requires separate approval. No npm publication is needed for the
Registry path. No plugin-supplied JavaScript runs in the browser: EmDash renders
Block Kit JSON and sends authenticated private interactions to the sandbox.
The only runtime access is declared plugin storage; no network hosts or
Inventory service are required for unmanaged products.

The released CLI requires lowercase storage collection names. Fresh sandbox
installs use snake_case names, preserving the kernel record shapes and actual
unique-index checks. The legacy native API entry keeps its camelCase storage
and retains its React Products and Store pages through the separate `./admin`
compatibility export. **This is not a native-to-sandbox
upgrade path:** do not replace a populated native installation with this
artifact. Data migration and live Inventory service wiring are separate work.
The Cloudflare development limitation above remains; proof uses a disposable
SQLite site with a real workerd runner, not an in-process fallback.

See [sandbox admin implementation](docs/implementation/sandbox-admin.md) for
the build, local installation and proof steps.

## Direction

- Commerce owns sellable product and variant identity, price, sellability,
  cart, checkout orchestration, receipts, and orders.
- A product may opt into managed stock. Commerce then uses one configured
  inventory provider and never stores a fallback quantity.
- Storefront display and backorder behavior are Commerce policy. Inventory
  remains the only authority for the quantity those rules evaluate.
- DinkusKit Inventory is the default first-party inventory system; it remains
  the authority for physical quantities, locations, reservations, and stock
  movements.
- Stripe-first checkout comes before additional payment or reward systems.
- Humans remain in charge. The EmDash admin and agent surfaces must expose the
  same durable operations and understandable recovery states.

## Development

```bash
npm ci
bin/verify-commerce quick
bin/verify-commerce full
```

The quick verifier covers types, unit contracts, feature boundaries, public
repository hygiene, the exact EmDash API peer, and the exact private-pilot fork
contract. The full verifier additionally runs cross-process SQLite atomicity
proof against EmDash's real 0.41.0 storage repository and a two-process local
Wrangler/D1 expression-index proof, plus the real workerd + SQLite
admin/browser flow (`npm run test:sandbox` to run that boundary alone) and the
opted-in native local-stock browser (`npm run test:sandbox:native-local-stock`)
after the standard sandbox suite. Install Chromium first with
`npx playwright install chromium`. No live site or Registry publication is used.

Under construction. MIT licensed.
