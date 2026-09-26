# Commerce products admin proof

Command: `bin/verify-commerce full`

Result: exit 0. Unit tests 104 passed. Integration tests 19 passed.

Clerk behavior covered by `tests/features/catalog/product-admin.test.mjs`:

- Add product sends only command id, name, and SKU.
- Regular `12` and Sale `$10` save and list as `12.00` and `10.00`.
- `12.999` and `abc` are refused and the stored price is unchanged.
- `12.5` and `$12` save as `12.50` and `12.00`.
- A Sale that is not lower than Regular is refused and the stored price is unchanged.
- Clearing Regular while a Sale remains is refused.
- Blanking both fields ends the sale and unprices the product.
- `$0` lists as `0.00`.
- Lowering Regular below the current Sale stores the new lower Sale in one price write. A failed write leaves the stored Regular and Sale unchanged.
- The Products page is declared on the native plugin, and the list and save routes require `content:edit_any`.

The EmDash admin screen was not opened in a browser. The page posts these same routes.
