# Commerce keeps no policy records

Covers `policy-pages-are-content-20261031`. Ronald, 31 Oct 2026, on the
recommendation: "What I recommend — agreed"; earlier the same day: "The page
would always show its EmDash text — I think this was my intended design." It
supersedes `jsonld-policy-records-059` and reverifies
`jsonld-builder-export-059`, which keeps its export without policy input. The
storefront side is the Template Store's `policy-pages-content-20261031`.

## What changed

- **Route.** The public `policies/public` read is gone from the Registry build.
- **Storage.** `store_shipping_policy` and `store_return_policy` leave
  `emdash-plugin.jsonc` (and `storeShippingPolicy` / `storeReturnPolicy` the
  native entry). Nothing ever wrote them on the Registry build, so no store
  loses data.
- **Feature.** `src/features/store-policies/`, its tests and the
  `@dinkuskit/commerce/features/store-policies` export are removed; the feature
  audit now refuses that export.
- **JSON-LD builder.** `buildProductJsonLd` takes no `policies` input; its
  Offer carries no `shippingDetails` or `hasMerchantReturnPolicy`, and
  `assertProductJsonLdShape` refuses an Offer that does.
- **Docs.** The reference article, README, FEATURE_MAP, route-auth manifest
  notes and `docs/implementation/product-jsonld-policies.md` say a store's
  policies are its EmDash pages and Commerce has no policy route.

## Size

| `backend.js` | bytes | under the 131,072-byte cap | SHA-256 |
| --- | ---: | ---: | --- |
| `main` `805c7ea` | 129,540 | 1,532 | `e24ac8e7…` |
| this change | 129,126 | 1,946 | `8ebc83a6…` |

Two clean builds of this change emit the same digest.

## Proof (31 Oct 2026, Node 24.22.0)

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | 851 of 852; the one failure is the native consumer smoke teardown in `tests/workflows/packaged-consumers.test.mjs`, which fails the same way on untouched main in the proof container (#243 and #245 recorded it) |
| `npm run test:integration` | 111 of 111 |
| `npm run audit:repo` | `public_repository_contract=clean`, `feature_contract=clean` |
| `bin/verify-commerce storefront` | 11 passed |
| `bin/verify-commerce packaged` | 3 passed, plus `native_npm_consumer=pass` |
| `npm run test:settings` | 2 passed (Registry and native) |
| `npm run test:registry-upgrade` (from v0.5.0) | `registry_upgrade=pass`: old phase 1 passed, new phase 1 passed |
| `tests/route-auth.test.mjs` | the Registry build's public routes are exactly the documented set, without `policies/public` |
| `tests/features/structured-data/jsonld-builder.test.mjs` | the Offer carries no shipping or return terms, legacy policy input is ignored, and the shape check refuses terms on an Offer |

## Existing stores

EmDash deletes a plugin's stored rows only when the plugin is uninstalled with
its data; a collection a plugin stops declaring keeps its rows in
`_plugin_storage`, and these two collections declared no indexes to drop. The
policy feature is identical from v0.5.0 to v0.7.0, so a record written by
v0.7.0's native settings routes has the shape v0.5.0 stores.

`npm run test:registry-upgrade` (`scripts/registry-upgrade-proof.mjs`, from
v0.5.0, `registry_upgrade=pass`) now covers them:

- **Before.** v0.5.0's Registry build stocks the store through its own admin
  and holds an `active` shipping and return record in each of the Registry
  collections (`store_shipping_policy`, `store_return_policy`) and the native
  ones (`storeShippingPolicy`, `storeReturnPolicy`); v0.5.0's own
  `policies/public` serves the Registry pair back.
- **After.** This build restarts on the same database: the existing checks hold
  (stored products, prices and settings unchanged, the shop unchanged, the page
  claims its product, the panel edits it), `policies/public` no longer answers,
  and all four policy rows are byte-for-byte as they were, so a merchant who
  wants that text back can read it from the database.

The proof's panel check now reads #244's product card (status and SKU as
before); it had not been run since that redesign.

## Follow-up outside this repository

The Template Store's tests read Commerce's manifest route list
(`tests/workflows/commerce-profile.test.mjs`, `tests/workflows/access-route-policy.test.mjs`
name `policies/public`); they move with the Template Store's Commerce pin when
it takes a release with this change.
