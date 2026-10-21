# Public storefront metadata and feed prerequisites

## Scope and source

- Repository: `dinkuskit/commerce`.
- Branch: `codex/preview-product-jsonld-035-20261020`.
- Original base: `819fbf903a1e0a6eaab7349d795cc75d15588f31`.
- Preview implementation: `cfa134eaf4c61fab23ffb2c0c33d8bc660192652`.
- Public feed implementation: `c61d63647b3eb7f990d935f170dd93eb6d1c56dd`;
  review repair cycle 1 preserves its runtime source unchanged.
- Decisions: `jsonld-preview-product-035` and `public-feed-eligibility-035`, both
  confirmed before their implementations.
- Exact current implementation content: `source-manifest.sha256` here.
- This is local source and verification proof. Coordinator exact-head review,
  merge, and release remain separate. This worker made no push or deployment.

## Public API and behavior

```ts
buildProductPreviewJsonLd(
  input: BuildProductPreviewJsonLdInput,
): ProductPreviewJsonLd;
```

The preview input requires `url` and `name`, with optional `description` and
`images`. Its schema.org Product result contains only those page facts, with
no SKU, GTIN, MPN, brand, price, availability, or Offer. The preview builder and
existing SKU-bearing builder/validator are unchanged by the feed completion.

Both `catalog/public` and `catalog/public/item` now project the existing
merchant eligibility record as `feedChannels?: readonly ProductFeedChannel[]`.
The only accepted ids are `google-merchant` and `meta-catalog`. A missing record
or explicit opt-out returns `[]`; an older adapter without the collection omits
that optional field. Neither case opts in. Unsupported stored channels fail
validation instead of escaping into a public result.

The actual native and compiled Registry route handlers returned this product
shape in the focused fixture (also equal to the corresponding list element):

```json
{
  "id": "eligible",
  "name": "eligible",
  "sku": "ELIGIBLE",
  "price": { "currency": "USD", "minor": "1250" },
  "availability": { "status": "in-stock", "sellable": true, "listable": true },
  "image": null,
  "gallery": [],
  "feedChannels": ["google-merchant", "meta-catalog"]
}
```

The tests also pass these public results to the actual Google and Meta feed
builders. Only the eligible product appears. They verify empty, missing, and
unsupported eligibility, opt-out on subsequent reads, exact public keys, and
unchanged public GET/no-store route declarations without an admin permission.

## Verification

Environment: Node `v24.22.0`; dependencies installed using `npm ci`.

| Command | Observed result |
| --- | --- |
| `npm run build` | Passed, including plugin validation and Registry packaging |
| `node --test tests/features/structured-data/*.test.mjs` | 11 passed, 0 failed; 7 existing and 4 preview tests |
| `node --test tests/features/feeds/*.test.mjs tests/features/catalog/public-catalog*.test.mjs tests/features/catalog/public-entry.test.mjs` | 29 passed, 0 failed |
| `bin/verify-commerce core` | Passed: typecheck/build/audits, 619 unit tests, 99 integration tests, 10 sandbox/native browser tests, 1 native-local-stock browser test, 3 orders/packaged-consumer browser tests, and native npm-consumer verification |
| `node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target ES2022 --module NodeNext --skipLibCheck .grilltrack/proof/preview-product-jsonld-035/public-api.mts` | Passed, including preview type boundaries, preserved SKU type, and closed public channel ids |
| `node .grilltrack/proof/preview-product-jsonld-035/host-graph.mjs` | 312 modules from `src/plugin.ts`; zero structured-data modules |
| `git diff --check` | Passed |
| `scripts/grilltrack --project . validate` | Valid |

The focused handler tests cover native camelCase storage, native snake_case
fallback, and compiled Registry snake_case storage. Native mapping uses the
existing `PRODUCT_FEED_ELIGIBILITY_COLLECTION`; the shared reader uses the
Feeds-owned sandbox collection key and `loadProductFeedEligibility`.
An independent literal-key test also checks the native schema and proves
`productFeedEligibility` wins over a conflicting snake_case fallback.

The installed workerd integration now checks both public routes with no
eligibility, after merchant admin opt-in, after opt-out, and after runtime
restart. It preserves the existing canonical checkout/order assertions.
All four task-specific loopback ports were closed after the core run.

The existing public catalog subrequest tests now include eligibility records.
All list pages for 10, 50, and 150 products remain at or below 32 subrequests;
each tested item read remains at or below 12. Batched and get-only adapters
produce equal public products. Eligibility uses one batched collection read
per page when supported, preserving request-local caching.

Final Registry packaging reported `backend_bytes=119426`,
`headroom_bytes=11646`, and SHA-256
`9873195d98ce4dc61eee336a0719c3199f44233a61f736d742bfe41e7a77467d`.
The graph check uses the same entry, platform, optimization, and coupon
transform as `scripts/build-sandbox.mjs`; all structured-data modules remain
absent. Host feed builders are not newly imported into the Registry graph.

The repository audit scans ignored directories too. During verification,
only this task's generated logs were temporarily held under ignored
`.grilltrack/work/`, then restored. Raw command output is under ignored
`runs/preview-jsonld-035-runs/` and is not public proof.

Two preliminary verification harness mistakes were corrected: the standalone
TypeScript 7 check needed `--ignoreConfig`, and the compiled Registry handler
needed its actual `(route, context)` calling convention rather than the native
single-context convention. Final commands above passed; neither repair
required changing the corresponding product behavior.

## Local inspection and limits

The public projection copies only the channel ids returned by the existing
eligibility reader, never the record or admin-only fields. No auth declarations,
permissions, allowed hosts, storage schema, feed opt-in mutations, or preview
builder behavior changed. Review cycle 1 rejected the native mapping finding
as a false positive and accepted/fixed an outdated integration expectation.
See [REVIEW-REPAIR-1.md](REVIEW-REPAIR-1.md) for the exact evidence and
classification. This cycle changes only tests and proof/ledger records.

Preview checks reject missing, non-string, empty, and whitespace-only
URLs/names. The host remains responsible for canonical URLs, public image URLs,
and truthful page content. The core suite supplies installed runtime, browser,
and packaged consumer proof, while the new literal-key test invokes the native
route handlers. It does not establish a production deployment. Storefront
integration and fresh exact-head CI/comprehensive/native review remain
coordinator-owned.
