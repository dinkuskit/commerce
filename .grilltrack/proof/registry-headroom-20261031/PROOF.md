# Registry backend headroom, 31 Oct 2026

Covers `registry-headroom-20261031` (Ronald, 31 Oct 2026: "agreed lets do
this", the shaves landing first as their own PR). Base: Commerce `main`
`26d6319` (after commerce#243).

## What changed, and what did not

Six behavior-preserving changes, each measured on the final `backend.js` the
official packaging emits (literal sharing and the plugin CLI's own minify
included), not on the Rolldown prebundle:

1. **Build options.** `scripts/build-sandbox.mjs` lets Rolldown inline
   constants (`optimization.inlineConst: true`) and tree-shake without
   property-read or unknown-global side effects. Measured alone: 120 bytes.
2. **Shared Block Kit field helpers.** `src/admin/common.ts` builds text
   inputs, radios, toggles, fresh form ids and submit buttons once;
   `src/admin/products.ts` and `src/admin/settings.ts` call them. Every block
   keeps its type, action id, label, options and initial value.
3. **Stock management on the Registry build.** `normalizeStoredStockManagement`
   answers managed or unmanaged only there (`REGISTRY_BUILD`): the Registry
   build has no Inventory binding and nothing in it reads a managed record's
   setup status, while a managed record still resolves unavailable
   (`tests/integration/registry-checkout-services.test.mjs`, "preserves managed
   binding"). The native entry keeps the full parse.
4. **Wake reconciliation** records a retained wake through one helper
   (`src/features/checkout/wake.ts`); statuses and reasons are unchanged.
5. **ISO 3166-1 alpha-2** lives as a 676-bit table (26 x 26 letters, base64)
   in `src/features/store-settings/normalize.ts`; membership and the sorted
   listing round-trip the former 249 codes exactly.
6. **The manage-stock notice** has one text on the Registry build, where a
   product is never managed.

No route, storage record, message, validation rule, manifest entry, grant or
admin block changes. Source-map attribution (diagnostic only) put the backend's
largest contributors at checkout (46.8 KB), catalog (45.5 KB), orders
(16.5 KB), the product admin (15.5 KB) and shopper accounts (10.0 KB).

## Measured

| Build | `backend.js` bytes | headroom under 131,072 | SHA-256 |
| --- | ---: | ---: | --- |
| `main` `26d6319` | 130,246 | 826 | `c031be50ee8b350c5e15998a966bafed55af392c802a8f32acbdff1a573838c3` |
| this change | 128,266 | 2,806 | `3700b9dd8003a6651543fcf68cbd6852b7a37781e47e7f0e559e8959bf142abd` |

Two clean builds of this change emit the same digest; main's digest is the one
commerce#243's own proof recorded, so #243 left the Registry backend untouched.

There is no fixed reserve to restore: the only size rule is the 131,072-byte
per-file cap. The 2,200-byte figure was the room left on 21 Oct 2026, not a
rule (`commerce-connect-size-20261022`; Ronald, 31 Oct 2026: "We don't need a
reserve"), and `us-region-registry-budget-exception-20261021`, the exception
to it, is superseded. For the record: store policy editing on the Settings
page, built and measured in the same session, costs 2,828 bytes; it waits for
Ronald's choice and is not in this change.

## Observed

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` (full unit suite with build) | 838 of 839 pass; the one failure, `native consumer smoke teardown destroys stdio streams, unrefs host, and escalates process group to SIGKILL` (`tests/workflows/packaged-consumers.test.mjs`), fails the same way on untouched `main` in this container (process-group signalling), as commerce#243's proof records |
| `npm run test:integration` | 110 of 110 pass, including "default module rejects foreign origin before settings/credentials and preserves managed binding" |
| `npm run audit:repo`, `git diff --check` | `public_repository_contract=clean`, `feature_contract=clean`; no whitespace errors against `main` |
| `bin/verify-commerce storefront` (build, `npm run test:sandbox`) | passed: `tests/sandbox` 11 passed (3.0m) against this backend (`registry_bundle=pass`, 128,266 bytes). The first attempt never started its server: a session restart had left an astro dev lock naming a dead process, which was removed before the rerun |
| `bin/verify-commerce packaged` (orders Block Kit proof, packaged consumers) | passed: orders Block Kit and packaged-consumers specs 3 passed (51.8s); `native_npm_consumer=pass declared-exports installed-native-admin foreign-origin-denial` |
| `npm run test:settings` (Registry and native merchant settings pages) | passed: `merchant-settings.spec.mjs` 2 passed (1.2m), one run on the Registry build and one on the native entry |
