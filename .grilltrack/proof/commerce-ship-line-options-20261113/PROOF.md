# Item options go to Ship

Covers `commerce-ship-line-options-20261113` (commerce#264). Ronald, 13 Nov
2026 15:57 UTC: "agreed" to one optional one-line text field per Ship line,
the same text as the Orders page, with no resync of orders Ship already has.

## What changed

- `src/features/orders/store.ts` gains `lineOptions(order, catalogItemId)`:
  the line's frozen variant choices from `paidOrder.variantSelections`, matched
  by catalog item id, as `optionLabel: valueLabel` joined with ` · `. The
  Orders page's items table now uses it, so the two surfaces cannot drift.
- `src/features/orders/ship.ts` sends it as `options` on each line, made one
  line and cut to at most 200 UTF-16 units without splitting a character (the
  same `cut` the store's name already used). A line without choices sends no
  `options`, so a simple product's record is byte-for-byte as before.
- Orders already synced are not resent; `shipVersion` and versioning are
  unchanged.

## Verification

- `tests/features/orders/ship.test.mjs`: two sizes of one tee go as
  `Size: M` and `Size: L · Colour: Smoke Grey` (a typed line break made one
  space); a product without options has no `options` key; a long choice is cut
  to 200 UTF-16 units without leaving half a character.
- `bin/verify-commerce quick` passes (856 unit tests, repo and feature audits).
- Registry bundle: `backend.js` 130,307 bytes on main (`12a15e6`, 765 headroom)
  to 130,391 bytes (681 headroom), 84 bytes for this change. After main moved to `27fd637` (commerce#267): 130,421 (651 headroom) on main, 130,513 (559 headroom) with this change, 92 bytes.
