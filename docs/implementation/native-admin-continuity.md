# Native Admin Continuity Compatibility

## Context and Purpose

PR27 transitioned the primary Commerce distribution path to the registry-safe
sandboxed plugin using EmDash Block Kit JSON (`src/admin/index.ts`, `emdash-plugin.jsonc`).
However, existing native pilot deployments require administrative continuity to access
and manage existing product catalogs, price records, manual availability states,
managed setup indicators, and Store settings.

This repair restores the native descriptor entries and module exports as a compatibility
layer, ensuring existing native sites remain operational pending tested production migration.

## Architectural Boundaries

1. **Approved Sandbox Direction**:
   - The registry sandbox (`format: "sandbox"`, `emdash-plugin.jsonc`, `src/admin/index.ts`)
     remains the canonical delivery path for fresh installations.
   - No production migration or automated data schema conversion is performed in this slice.

2. **Native Compatibility Layer**:
   - Native descriptor `adminEntry` (`@dinkuskit/commerce/admin`) and `adminPages`
     (`/products`, `/store`) are restored in `dinkusCommerce()` and `createPlugin()`.
   - Separate entry point `src/admin/native.ts` exports `pages: { "/products": ProductsPage, "/store": StorePage }`.
   - `package.json` exports `./admin` mapping to `./dist/admin/native.js` with TypeScript definitions.
   - `react` peer dependency (`^18.0.0 || ^19.0.0`) is retained for native compatibility hosts.
   - Recovered exact public same-repo native admin UI (`src/admin/products-page.ts`, `src/admin/store-page.ts`)
     from commit `51ab023b14490e3bff821e5310dd1c323092df30`.
   - Preserves existing catalog kernels, storage constraints, and Block Kit admin handlers.
