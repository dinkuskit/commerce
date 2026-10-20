# Editorial Product preview JSON-LD

## Scope and source

- Repository: `dinkuskit/commerce`.
- Branch: `codex/preview-product-jsonld-035-20261020`.
- Base: `819fbf903a1e0a6eaab7349d795cc75d15588f31`.
- Decision: `jsonld-preview-product-035`, confirmed before implementation.
- Exact implementation content: `source-manifest.sha256` in this directory.
- This is local source and verification proof. Coordinator review, merge, and
  any release remain separate; no push, deployment, or release occurred.

## Public API

```ts
buildProductPreviewJsonLd(
  input: BuildProductPreviewJsonLdInput,
): ProductPreviewJsonLd;
```

The input requires `url` and `name`, with optional `description` and `images`.
The result is a schema.org `Product` containing only those supplied page facts.
It has no SKU, GTIN, MPN, brand, price, availability, or `Offer`. The existing
Commerce product builder and its SKU-bearing output/validator are unchanged.

## Verification

Environment: Node `v24.22.0`; dependencies installed using `npm ci`.

| Command | Observed result |
| --- | --- |
| `npm run build` | Passed, including plugin validation and Registry packaging |
| `node --test tests/features/structured-data/*.test.mjs` | 11 passed, 0 failed; 7 existing and 4 preview tests |
| `bin/verify-commerce quick` | Passed: typecheck, build, 609 unit tests, repository and feature audits |
| `node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target ES2022 --module NodeNext --skipLibCheck .grilltrack/proof/preview-product-jsonld-035/public-api.mts` | Passed, including expected rejection of missing facts/unsupported identity fields and preservation of the existing SKU type |
| `node .grilltrack/proof/preview-product-jsonld-035/host-graph.mjs` | 312 modules from `src/plugin.ts`; zero structured-data modules |
| `git diff --check` | Passed |
| `scripts/grilltrack --project . validate` | Valid |

Registry packaging reported `backend_bytes=119271`, `headroom_bytes=11801`, and
SHA-256 `1d03bdb4cebaf56d1a5db12e654eff941df6dcf9b9ba61d68df00869ddd5916a`.
The build graph check uses the same entry, platform, optimization, and coupon
transform as `scripts/build-sandbox.mjs`. It asserts that the entire
structured-data feature is absent, rather than relying on emitted symbol names.

The repository audit scans ignored directories too. During the quick gate,
only this task's generated logs were temporarily held under ignored
`.grilltrack/work/`; they were restored afterward. Raw local command output is
under ignored `runs/preview-jsonld-035-runs/` and is not part of the public proof.

One preliminary standalone type-check invocation omitted the TypeScript 7
`--ignoreConfig` flag and failed with TS5112. The corrected command above
passed. No implementation change was needed.

## Local inspection and limits

Source intent: the preview builder constructs an allowlist of page facts;
tests pass extra identity and transaction properties and verify their omission.
No existing product builder, validator, sandbox entry, policy, or runtime file
was changed. Documentation distinguishes the preview from SKU-bearing Commerce
output. Local inspection found no required fix.

Required-fact checks reject missing, non-string, empty, and whitespace-only
URLs/names. The host remains responsible for canonical URL selection, absolute
image URLs, and truthful page content; the helper does not fetch or verify them.
Browser or merchant integration proof was not run for this pure helper. The
consuming storefront and exact-head review are coordinator-owned follow-up.
