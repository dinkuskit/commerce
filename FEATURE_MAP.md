# Feature ownership map

This map is the repository contract for bounded Commerce feature work. A feature owns its listed implementation paths and reaches another feature only through that feature's public entry. The package root may compose feature entries but must not import feature internals.

| Stable feature ID | Responsibility | Owned paths | Public entry point | Allowed shared dependencies | Fixtures and tests | Quick verifier | Full behavioral-proof command | Public compatibility surface | Structure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.catalog` | Catalog item creation, site-wide SKU identity, command idempotency, and fail-closed storage-integrity proof | `src/features/catalog/` | `src/features/catalog/index.ts`; package root; `@dinkuskit/commerce/features/catalog` | EmDash 0.35 plugin and storage types only | `tests/features/catalog/`; `tests/integration/`; `proof/catalog-first-managed-sku/PROOF.md` | `bin/verify-commerce quick` | `bin/verify-commerce full` | `commercePlugin`; authenticated `catalog-items/create` route; `createCatalogItem`; canonical SKU and error contracts | migrated pilot |

## Boundary rules

- A feature may import its own files, declared shared modules, third-party packages, and another feature only through that feature's `index.ts`.
- Files outside a feature may reach it only through its `index.ts`; `src/index.ts` is the package composition root.
- Tests consume publishable behavior through the package build or the feature's public entry, not a private implementation file.
- Commerce owns catalog identity, sellability policy, price, and the configured inventory-provider binding. It does not own stock quantities, locations, reservations, movements, or a fallback stock ledger.
- The catalog pilot creates only draft simple products. Price, stock policy, Inventory calls, updates, deletion, UI, MCP, checkout, publication, package publication, deployment, and production mutation remain outside this slice.
