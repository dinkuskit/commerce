# Persist Manage stock

- Track `gt-20260926183503-6113fc` on `openclaw/grill-manage-stock-20260926`
- Base `057ebe8` (`emdash@0.41.0`)

## Clerk

- Same Products Save as Regular and Sale checks or unchecks Manage stock.
- On: persist setup-required; hide In stock / Out of stock / On backorder; no Configure Inventory; no quantity.
- Off: dormant stock status returns; Commerce setup claim is compareAndDelete'd; Inventory is not contacted.
- Configure Inventory persist uses compareAndSet and aborts if the product is already unmanaged.
- Uncheck while `setup-pending` is refused; Inventory setup can still contact Inventory. Clerk retries Save after it finishes.
- Claim release runs only after the catalog row is unmanaged. If that cleanup fails, the next unmanaged Save retries it so re-enable can start a fresh setup.
- Prices are not rewritten.

## Verification

- `npx tsc --noEmit` passed
- `tests/features/catalog/product-admin.test.mjs` and `tests/features/inventory-setup/inventory-setup.test.mjs` including concurrent disable vs Configure Inventory
- Throwaway `template-store` host, port 64464, Playwright `chromium-desktop`: check Manage stock hides radios; uncheck restores Out of stock; Regular 12.00 / Sale 10.00 unchanged
- Captures published after this head as `commerce-pr-26-<head12>` on `dinkuskit/dinkus-pr-assets`

SHA-256:

- `manage-stock-on.png` `00360438f42de68188168bcf33b0519fcf86c5a6a5bac420a56228aa4dca3725`
- `manage-stock-off.png` `f2ce4701fc49fac16309ada00e412362770c2a5f970266e307d3b754e5f62ae8`
