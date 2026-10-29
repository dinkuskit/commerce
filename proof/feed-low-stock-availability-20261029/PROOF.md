# Low stock remains available in product feeds

## Scope and source

- Parent: `04dcf5e1ef296cc9ca8d719a11fec731d6961660`, Commerce `0.6.0`.
- Branch: `saarius/fix-feed-low-stock-availability`, independent of the earlier CLI, catalog-preview and payment-admission contributions.
- Node `v24.22.0`, Linux x64, dependencies from the existing lockfile.
- Routine serialization repair under `feeds-facts-consistency-060`: feeds consume the authoritative public availability, rather than contradicting it. No product decision or ledger state is changed.

`src/features/feeds/builder.ts:availability()` handled `in-stock` and `available-on-backorder`, with every other status falling back to out of stock. Consequently, a normal `low-stock` projection (`sellable: true`, `listable: true`) emitted out-of-stock values in **both** feeds, even though Product JSON-LD correctly emitted `https://schema.org/LimitedAvailability`.

The local output mismatch is directly observed; any downstream suppression of products is a possible consequence, not a demonstrated Google/Meta account result.

## Reproduction before repair

Added regression tests, then ran them against the built upstream implementation before rebuilding with the source repair:

```sh
node --test \
  --test-name-pattern='feed availability matches canonical|managed low-stock availability stays|low-stock feed rows still require' \
  tests/features/feeds/product-feeds.test.mjs \
  tests/features/storefront-availability/storefront-availability.test.mjs
```

**Before:** exit 1, **5 pass / 2 fail**. Both the direct public-projection case and the case using the real availability resolver produced:

```text
actual:
  google: out of stock
  meta:   "out of stock"
  jsonLd: https://schema.org/LimitedAvailability
expected:
  google: in stock
  meta:   "in stock"
  jsonLd: https://schema.org/LimitedAvailability
```

The resolver case uses the existing synthetic Inventory fixture, five available units and a low-stock threshold of five. `resolveManagedStorefrontAvailability()` performs its real provider-result validation and returns `low-stock`, `sellable: true`, `listable: true`. The test then passes only public product facts to the actual feed and JSON-LD builders. It does not contact an Inventory deployment or create a second stock authority.

Baseline built feed-module SHA-256: `d96569ff2528afaa701298a3889e556bb0319493f385e6a19f4cfcb8ad2a3161`.

## Repair and controls

Add `case "low-stock":` beside `case "in-stock":` in the shared feed mapping. No other runtime line changes.

| Canonical status | Google feed | Meta feed | JSON-LD (unchanged) |
| --- | --- | --- | --- |
| `in-stock` | `in stock` | `in stock` | `InStock` |
| `low-stock` | `in stock` | `in stock` | `LimitedAvailability` |
| `out-of-stock` | `out of stock` | `out of stock` | `OutOfStock` |
| `available-on-backorder` | `backorder` | `available for order` | `BackOrder` |
| `availability-unavailable` | `out of stock` | `out of stock` | `OutOfStock` |

Seven new tests cover all five statuses, nonmutation of input, actual managed low-stock resolution, and preservation of the existing exclusion gates. Low stock still does not bypass merchant opt-in, a missing price, nonlistability, an empty canonical URL, or an empty title.

[Google's official availability guidance](https://support.google.com/merchants/answer/6324448?hl=en), checked 2026-10-29, describes in-stock semantics as accepting orders and being able to fulfill them. This is a semantic cross-check only: this repair preserves existing channel value spellings and is **not** a complete feed-specification audit or a claim of successful Google/Meta ingestion.

## Verification

On the final source/test/docs tree:

- `npm test`: **715/715 pass**, no skips (708 parent tests + seven new tests).
- `node --test tests/integration/*.test.mjs`: **106/106 pass**, no skips.
- Focused feed, availability and structured-data suites: **59/59 pass**.
- `npm run typecheck`: pass.
- `npm run audit:repo`: public repository and feature contracts clean.
- `./scripts/grilltrack --project . validate`: valid.
- `git diff --check`: clean.

Run build/unit and integration commands sequentially; the build regenerates `dist`.

Repaired built feed-module SHA-256: `9c8e5d33221e16f82f1aeb1559a854bfd2e2e8a502901089bffa6efa1b3e8626`.

Registry backend remains **byte-identical to the parent**: **131033 bytes**, **39 bytes headroom**, SHA-256 `29e86beb6d40af0050ea8e2582113aa5dc65417d355c535ac765bab0ea1ecf68`. The serializer is a host-side export, outside the Registry backend graph. The repair does not add managed stock to the Registry runtime or change v1 scope.

**Docs: up to date.** The implementation note and website reference explain the low-stock mapping, and a patch changeset records the fix. No dependency, storage, capability, route, manifest, payment, deployment or production change. The new tests use synthetic fixtures; no real stock, processor, production store or Google/Meta account was involved. Browser UI and real channel ingestion are not claimed as tested.
