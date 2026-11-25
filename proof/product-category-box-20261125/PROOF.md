# Product category panel (product-category-box-20261125)

The owner chose on 24 Nov 2026 to build the box into Commerce like Shopify, and for this PR to carry its own
behaviour-preserving trim. It builds `template-product-category-pick-20261124` (template-store ledger): copy
Shopify, the box arrives filled with a suggestion and saving the page confirms it.

| Requirement | Passing case | Refused or fallback case | Evidence |
| --- | --- | --- | --- |
| An unpicked page gets a suggestion from its own words | "Wool beanie, a warm knit hat" fills `aa-2-17-2` Beanies into the draft | a page with a saved category is never patched | `1-new-product-suggested.png`; `product-category.test.mjs` |
| Search lists matches, Use fills the box | "baseball cap" lists 8 matches; Use on Baseball Caps sets `aa-2-17-1` | a search alone changes nothing | `2-search-baseball-cap.png`, `3-used-baseball-caps.png` |
| A saved category shows by name | `aa-2-17-2` reads "Category: Apparel & Accessories > Clothing Accessories > Hats > Beanies" | with the catalog down it reads "Category: aa-2-17-2", and a fresh page reads "Uncategorized" with no patch | `4-saved-category.png`; `product-category.test.mjs` |
| Fits a phone | 390 px wide, no sideways scroll; long names wrap beside their Use button | | `5-phone-search.png` |
| The Registry build serves it through EmDash | EmDash's panel dispatch and draft-patch policy, its allowed-host check (DNS lookup of catalog.dinkuskit.com), the patch of `product_category` | | `product-category.test.mjs`, last test |
| The trim changes no behaviour | the full unit suite on the shorter build (below) | functions that could tell the difference are left alone | `build-arrow-functions.test.mjs` |

The screenshots come from the real pinned Block Kit renderer (`@emdash-cms/blocks` with Kumo styles) in Chromium,
driving this build's `productCategoryPanel`. The catalog's answers are the live catalog.dinkuskit.com answers of
25 Nov 2026 (Worker version 5cb06ca6), saved in `live-beanie.json` and `live-cap.json` and replayed. The id answer
in `4-saved-category.png` is the one dinkuskit#168 adds; until that is deployed the panel shows the bare id. The
field above the panel stands in for the page's `product_category` field.

## Bytes

Registry backend (`npm run build`), on main 1c5f93f: 131,069 bytes (3 free). With this PR: 128,094 bytes
(2,978 free). The build step alone frees 3,787 bytes (measured on adb9fda: 131,003 to 127,216); the panel costs
about 850. The feeds library change adds nothing to the backend: the builders are host-side.

## Tests on the shorter build

`npm run test:unit` on this branch before the main merge: 874 of 877 passed. The 3 that did not:

- `installed-context.test.mjs`, "compiled installed export and sandbox metadata expose fixed public seam": it pins
  the permission and host lists, which this PR changes; updated, and it passes.
- `cart-email-stop-at-send.test.mjs` and `checkout-contact-integration.test.mjs`: workerd could not start in the
  container ("miniposix::write(fd, pos, size): Bad file descriptor", the same for any workerd test there). CI runs them.

`tests/upgrade/ship-date-upgrade.test.mjs` with Commerce v0.8.0's own bundle: passes on this build (products made
on 0.8.0 read, sell and save as before).

## Upgrade

No storage, route or data change. Installing or upgrading asks for two new grants: the `admin.editor-draft:patch`
permission (the Product category panel only, its `product_category` field only) and `catalog.dinkuskit.com` as a
network host.
