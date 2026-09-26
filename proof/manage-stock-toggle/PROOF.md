# Persist Manage stock

- Track `gt-20260926183503-6113fc` on `openclaw/grill-manage-stock-20260926`
- Base `057ebe8` (`emdash@0.41.0` after commerce #24)

## Clerk

- Same Products Save as Regular and Sale checks or unchecks Manage stock.
- On: persist setup-required; hide In stock / Out of stock / On backorder; no Configure Inventory; no quantity.
- Off: dormant stock status returns; Commerce setup claim is compareAndDelete'd; Inventory is not contacted.
- Prices are not rewritten. A refused Manage stock write leaves stored prices.

## Verification

- `npx tsc --noEmit` passed
- `tests/features/catalog/product-admin.test.mjs` — 14 pass, including check without rewriting price and uncheck restoring dormant Out of stock plus dropping the setup claim
- `bin/verify-commerce full` — 116 unit pass; 18/19 integration pass; the one Wrangler D1 store-identity case retried clean (`internal error` flake, not this slice)
- `feature_contract=clean` `public_repository_contract=clean`
