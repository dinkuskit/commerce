# Feature ownership map

This map is the repository contract for bounded Commerce feature work. A feature owns its listed implementation paths and reaches another feature only through that feature's public entry. The package root may compose feature entries but must not import feature internals.

| Stable feature ID | Responsibility | Owned paths | Public entry point | Allowed shared dependencies | Fixtures and tests | Quick verifier | Full behavioral-proof command | Public compatibility surface | Structure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.catalog` | Catalog item creation, site-wide SKU identity, managed-stock intent, command idempotency, and fail-closed storage-integrity proof | `src/features/catalog/` | `src/features/catalog/index.ts`; package root; `@dinkuskit/commerce/features/catalog` | EmDash 0.35 plugin and storage types; `dinkus.inventory-provider` public entry | `tests/features/catalog/`; `tests/integration/`; `proof/catalog-first-managed-sku/PROOF.md`; `proof/managed-stock-foundation/PROOF.md` | `bin/verify-commerce quick` | `bin/verify-commerce full` | `commercePlugin`; authenticated `catalog-items/create` route; `createCatalogItem`; canonical SKU, stock-management, and error contracts | migrated pilot |
| `dinkus.inventory-provider` | Opaque store-level provider binding, managed-SKU registration contract, and pure product stock-management transitions; never stock quantity or provider I/O | `src/features/inventory-provider/` | `src/features/inventory-provider/index.ts`; package root; `@dinkuskit/commerce/features/inventory-provider` | None | `tests/features/inventory-provider/`; `proof/managed-stock-foundation/PROOF.md`; `proof/managed-sku-registration/PROOF.md` | `bin/verify-commerce quick` | `bin/verify-commerce full` | `InventoryProviderBinding`; `InventoryProviderPort`; `ManagedSkuRegistrationRequest`; `StockManagement`; binding, registration, review, and enable/disable transitions | foundation |

## Boundary rules

- A feature may import its own files, declared shared modules, third-party packages, and another feature only through that feature's `index.ts`.
- Files outside a feature may reach it only through its `index.ts`; `src/index.ts` is the package composition root.
- Tests consume publishable behavior through the package build or the feature's public entry, not a private implementation file.
- Commerce owns catalog identity, sellability policy, price, and the configured inventory-provider binding. It does not own stock quantities, locations, reservations, movements, or a fallback stock ledger.
- `dinkus.inventory-provider` contains no network client, credential, quantity, or provider fallback. Its binding retains only provider, pool, and default fulfillment-location identities. Registration emits only pool, canonical SKU, and a one-time display-name default; an active Commerce link persists only the permanent Inventory SKU identity.
- The catalog pilot creates only draft simple products. Price, Inventory calls, persisted updates, deletion, UI, MCP, checkout, publication, package publication, deployment, and production mutation remain outside this slice.
