# One Commerce build: the native entry's extras removed

Covers `commerce-one-build-registry-20261031`. Ronald locked it on 31 Oct 2026
("lock it"): Commerce runs ONE build, the Registry (sandboxed) one, everywhere.
The Template Store moved its local dev, demo and browser tests onto the Registry
build first (`template-one-build-registry-20261031`); this is the Commerce half:
the native entry drops what the Registry build never had.

## What changed

- **Routes.** `src/index.ts` registers 15 routes, the Registry build's own
  minus Connect's `store-proof`, `orders`, `checkout/guest/readiness` and
  `policies/public`: the product panels, the private `catalog` route, the
  store's publish check (`catalog-items/set-on-sale`), the two public catalog
  reads, guest checkout and shopper accounts. Gone are the 24 native-only
  routes (built manifest before: native 39, Registry 19): `catalog-items/create`,
  `list`, `save-prices`, `save-media`, `set-sku`, `set-identifiers`, `rename`,
  `set-archived`, `add-variant-option`, `update-variant-labels`,
  `bulk-save-prices`, `set-backorders`, `set-manual-availability`,
  `set-regular-price`, `set-sale-price`, `clear-regular-price`,
  `clear-sale-price`, `set-feed-eligibility`, `configure-inventory`,
  `settings/storefront-availability`, `settings/out-of-stock-listing`,
  `settings/placeholder-image`, `settings/shipping-policy`,
  `settings/return-policy`. Their route objects, route-id constants and the
  `*WithLocalStock` factories are gone from the feature entries
  (`features/catalog/route.ts` keeps the publish check alone;
  `storefront-availability/route.ts`, `feeds/route.ts`,
  `store-policies/route.ts`, `inventory-setup/route.ts` and the matching
  `route-ids.ts` and `feeds/browser` entry are deleted).
- **Local Manage stock test aid.** `enableLocalStockManagement`
  (`features/catalog/local-stock-development.ts`) is gone, as
  `commerce-admin-block-kit-only-20261024` already called for; `dinkusCommerce()`
  and `createPlugin()` keep only `siteUrl`, `checkout` and `customers` options.
- **CLI.** `products list` sends `{op: "list"}` to the `catalog` route on every
  store; the native-first `GET catalog-items/list` and its fallback are gone.
- **Kernel untouched.** Every kernel function the removed routes called stays
  exported (`createCatalogItem`, `setCatalogItemManualAvailability`,
  `setCatalogItemRegularPrice`, `setStoreShippingPolicy`, …); the Template
  Store's seeds and proofs import them as a library.
- **Still native: the Template Store's playground only**, which registers
  `dinkusCommerce()` and calls none of the removed routes. The native entry
  itself goes with the playground's switch to the Registry build.
- **Docs.** README install type, the reference article's route note and
  saving section, CLI-SPEC, FEATURE_MAP rows and the implementation notes that
  named the routes. Changeset: minor.

## Gaps this exposes (for Ronald)

- Store policies now have no write on either build (`policies/public` reads
  collections nothing writes). Policy editing is a Commerce decision to make.
- Configure Inventory has no route until Inventory returns in Block Kit, as
  planned.

## Observed

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean after the removal |
| `npm run audit:repo` (repository contract, feature map) | `public_repository_contract=clean`, `feature_contract=clean` |
| `node --test` on the touched suites (CLI, catalog, inventory-setup, storefront-availability, workflows) | 170 of 171 pass; the one failure, `native consumer smoke teardown destroys stdio streams, unrefs host, and escalates process group to SIGKILL` (`tests/workflows/packaged-consumers.test.mjs`), fails the same way on untouched `origin/main` in this container (process-group signalling), so it is not this change |
| Built route manifest (`dist/sandbox/route-manifest.json`) | before: Registry 19, native 39, 24 native-only; after: Registry 19, native 15 (the Registry's minus `store-proof`, `orders`, `checkout/guest/readiness`, `policies/public`), no native-only route |
| `npm test` (full unit suite with build), on main after commerce#241 landed (`e482444`) | 838 of 839 pass; the one failure is the same pre-existing consumer-teardown test as above |
| `npm run test:integration` | 110 pass |
| `bin/verify-commerce storefront` (build, `npm run test:sandbox`) | passed: `tests/sandbox` 11 passed (3.5m) against the rebuilt bundle (`registry_bundle=pass`, `routes=19`, `public_routes=13`) |
| `bin/verify-commerce packaged` (orders Block Kit proof, packaged consumers) | passed: orders Block Kit and packaged-consumers specs 3 passed (47.7s); `native_npm_consumer=pass declared-exports installed-native-admin foreign-origin-denial` |
| `npm run test:settings` (native and Registry merchant settings) | passed: `merchant-settings.spec.mjs` 2 passed (1.1m), one run on the Registry build and one on the native entry |

