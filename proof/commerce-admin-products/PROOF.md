# Commerce products admin proof

Command: `bin/verify-commerce full` on earlier head `cf50aea`, then catalog tests on later heads.

Browser: Playwright Chromium desktop against a throwaway `template-store` host on EmDash 0.40.1, port 47551, Node 22.23.2. The host loaded this Commerce `dist` through `dinkusCommerce()`. Admin used `/_emdash/api/auth/dev-bypass` on a separate context. Unique catalog indexes appear after the Node scheduler's first maintenance pass.

Clerk behavior covered by `tests/features/catalog/product-admin.test.mjs` and the live admin page:

- Add product sends only command id, name, and SKU.
- Regular `12` and Sale `$10` save and show as `12.00` and `10.00`.
- `12.999` and `abc` are refused; the fields keep what was typed.
- Replacing Regular and Sale is one price write. A failed write leaves the stored Regular and Sale unchanged.

The admin module imports only route ids, plugin id, and the create payload helper. It does not bundle catalog storage.

Captures: GitHub release `commerce-pr-22-<head12>` on `dinkuskit/dinkus-pr-assets` after this head is pushed.
