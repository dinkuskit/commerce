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
| `tests/route-auth.test.mjs` | the Registry build's public routes are exactly the documented set, without `policies/public` |
| `tests/features/structured-data/jsonld-builder.test.mjs` | the Offer carries no shipping or return terms, legacy policy input is ignored, and the shape check refuses terms on an Offer |

## Follow-up outside this repository

The Template Store's tests read Commerce's manifest route list
(`tests/workflows/commerce-profile.test.mjs`, `tests/workflows/access-route-policy.test.mjs`
name `policies/public`); they move with the Template Store's Commerce pin when
it takes a release with this change.
