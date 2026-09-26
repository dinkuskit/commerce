# Commerce-owned product price proof

## Scope

This proof covers GrillTrack decisions:

- `price-money-001`
- `price-missing-002`
- `price-regular-sale-003`
- `price-sale-guard-004`
- `price-sale-requires-regular-005`
- `price-clear-sale-006`
- `price-clear-regular-007`
- `price-zero-008`

Commerce baseline:
`b9e432b1869bae09e394f5d631aa97b6949bf2fd`.

## Verified result

- Commerce stores Regular and optional Sale as Money `{ currency: "USD", minor }`
  with a string integer minor. Floats, non-USD currencies, and leading zeros
  are rejected.
- A missing Regular row is not listable and is never treated as `$0`.
- `$0` Regular is a free listable product. Sale cannot exist on it because it
  cannot be strictly lower than zero.
- Sale requires Regular and must be strictly lower in the same currency.
  Equal or higher Sale is refused; Regular is unchanged.
- Clearing Sale keeps Regular and the product stays listable.
- Clearing Regular while Sale exists is refused. After Regular is gone the
  product is not listable.
- Isolated `catalogPrices` writes never rewrite the catalog row.
- `resolveStorefrontAvailability` returns `listable: false` without contacting
  Inventory or manual availability when Regular is missing.
- Private POST routes require `content:edit_any`.

## Verification receipt

Final command:

```text
bin/verify-commerce full
```

Final result: exit `0`.

- TypeScript typecheck passed.
- Unit suite: 98 passed, 0 failed.
- Public repository contract: clean.
- Feature boundary contract: clean.
- Integration suite: 18 passed, 0 failed.
- Exact EmDash 0.40.1 storage proved Regular Money survives repository
  close/reopen and remains listable; missing Regular is not listable.
- A pre-price catalog row survives reopen with zero `catalogPrices` rows and
  resolves `listable: false`. The draft stays in the catalog. Operator
  remediation is `catalog-items/set-regular-price`.

The redacted upgrade transcript is retained at:

```text
proof/commerce-owned-product-price/live-runtime.txt
```

Manifest command:

```text
sha256sum -c proof/commerce-owned-product-price/source-manifest.sha256
```

The manifest covers every changed implementation, test, feature-map, verifier,
and product-document file in this slice. GrillTrack state and proof files are
excluded because they are workflow evidence rather than runtime source.

## Blast radius

| Surface | Risk | Evidence |
| --- | --- | --- |
| Persisted Regular/Sale | High | Money guards, orphan Sale, invalid Sale, clear sequence, `$0` vs missing |
| Storefront listing | High | unpriced products are not listable and skip Inventory; `$0` remains listable |
| Catalog row isolation | High | price writes never `put` the catalog item |
| Private admin actions | High | POST-only, `content:edit_any`, exact field allowlist |
| Existing availability | Medium | additive `listable`; prior status/sellable matrix retained for priced products |
| Pre-price catalog upgrade | High | live reopen: catalog row persists, zero price rows, not listable |

## Fidelity limits and deferrals

This slice does not add visual EmDash UI, sale schedules, checkout
enforcement, payments, Inventory transport, coupons, a Manage Stock toggle,
or a template-store dogfood hide. Commerce reports `listable: false` for
unpriced products; the storefront home page catch-up is a later slice.

Upgrade does not invent a Regular for existing drafts. Immediate de-listing of
unpriced products is the locked shop-owner contract, not a compatibility bug.

No push, pull request, merge, deployment, package publication, account change,
or production mutation was performed by this implementation step.
