# Product category panel (product-category-box-20261125)

The owner chose on 24 Nov 2026 to build the box into Commerce like Shopify, and for this PR to carry its own
behaviour-preserving trim. It builds `template-product-category-pick-20261124` (template-store ledger): copy
Shopify, the box offers a suggestion and saving the page confirms it.

EmDash opens a panel with no draft and lets a panel patch the draft only in answer to a click (`panel_load` takes
no `draft`; a patch without a draft invocation is refused). So the panel reads the saved page when it opens, and
the suggestion comes with a **Use** button: one click fills the field, and saving keeps it.

| Requirement | Passing case | Refused or fallback case | Evidence |
| --- | --- | --- | --- |
| An unpicked page is offered a suggestion from its own words | "Wool beanie, a warm knit hat" offers `aa-2-17-2` Beanies; Use fills it into the draft | opening changes nothing; a page with a saved category is offered nothing | `1-new-product-suggested.png`, `1b-suggestion-used.png`; `product-category.test.mjs` |
| Search lists matches, Use fills the box | "baseball cap" lists 8 matches; Use on Baseball Caps sets `aa-2-17-1` | a search alone changes nothing | `2-search-baseball-cap.png`, `3-used-baseball-caps.png` |
| A saved category shows by name | `aa-2-17-2` reads "Category: Apparel & Accessories > Clothing Accessories > Hats > Beanies" | with the catalog down it reads "Category: aa-2-17-2"; a page that cannot be read reads "Uncategorized" | `4-saved-category.png`; `product-category.test.mjs` |
| Fits a phone | 390 px wide, no sideways scroll; long names wrap beside their Use button | | `5-phone-search.png` |
| Only people who can edit any page reach it | an Editor (role 40) through EmDash's own editor dispatcher (`dispatchPluginEditorExtensionApiRequest`): opens, Uses, EmDash issues the patch for that page, the page is saved and reopens named | the page's own Author (30), a Contributor (20) and a Subscriber (10) get 403 `FORBIDDEN` on open and on Use, and nobody signed in gets 401; the catalog is never asked and its address never looked up | `product-category.test.mjs`, last two tests (log below) |
| The Registry build serves it through EmDash | the built `dist/sandbox` bundle, EmDash's draft identity and patch policy, its allowed-host check (DNS lookup of catalog.dinkuskit.com) | | `product-category.test.mjs` |
| The trim changes no behaviour | the full unit suite on the shorter build (below) | functions that could tell the difference are left alone | `build-arrow-functions.test.mjs` |

The screenshots come from the real pinned Block Kit renderer (`@emdash-cms/blocks` with Kumo styles) in Chromium,
driving this build's `productCategoryPanel` the way EmDash calls it (opening with no draft, clicks with the draft).
The catalog's answers are the live catalog.dinkuskit.com answers of 25 Nov 2026 (Worker version 5cb06ca6), saved in
`live-beanie.json` and `live-cap.json` and replayed. The id answer in `4-saved-category.png` is the one
dinkuskit#168 adds; until that is deployed the panel shows the bare id. The field above the panel stands in for the
page's `product_category` field.

**The refusal is load-bearing.** With the route's permission lowered to `content:read` on purpose, the refusal test
fails: the Author is answered with the suggestion. Restored, it passes.

```
$ node --test tests/features/catalog/product-category.test.mjs
✔ an unpicked product is offered the best match for its own words, which one click on Use fills in
✔ a saved category is named, and nothing in the draft changes
✔ a search lists matches, and Use fills the box until the page is saved
✔ with the catalog down the box still shows and still searches
✔ the Registry build answers an Editor through EmDash's own editor dispatcher, may patch only the category, and a saved pick reopens named
✔ someone without content:edit_any, even the page's own Author, is refused before the catalog is asked or a patch is made
ℹ pass 6
ℹ fail 0
```

## Bytes

Registry backend (`npm run build`), on main 1c5f93f: 131,069 bytes (3 free). With this PR: 128,249 bytes
(2,823 free). The build step alone frees 3,787 bytes (measured on adb9fda: 131,003 to 127,216); the panel costs
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
network host. EmDash's Registry shows both to the owner at install or upgrade, and the store keeps the version it
has until they are approved; `installed-context.test.mjs` and `registry-checkout-services.test.mjs` pin both lists.
The panel needs the template's `product_category` field (template-store `008_product_category`, merged); on a store
without it EmDash refuses Use's patch (`EDITOR_DRAFT_UNSUPPORTED_FIELD_TYPE`) and the page is not changed.
