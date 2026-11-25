# Expected ship date for backorders (commerce#308)

Decision `google-backorder-ship-date-20261124`, approved by the owner on 24 Nov 2026.

The screenshots come from the real pinned Block Kit renderer (`@emdash-cms/blocks` 1.5.0 with Kumo styles) in
Chromium, driving Commerce's own `productPanel` over a disposable in-memory catalog, the same way
`tests/sandbox/product-card-state.spec.mjs` does. No store, CMS database or provider was contacted.

| Shot | Shows |
| --- | --- |
| `2-on-backorder-box-appears.png` | Picking On backorder shows the Expected ship date box right under Stock status (it is hidden for In stock and Out of stock). |
| `3-saved-with-date.png` | Save keeps the date; the panel draws it back. |
| `4-passed-date-label.png` | A date that has passed: the label says "(passed: pick a new one)". |
| `5-public-catalog-and-google-feed.png` | The public catalog carries `availability.shipBy`; the Google feed sends `g:availability_date`; the same row with a passed date is left out of Google; the Meta CSV is unchanged. |
| `6-variant-L-has-its-own-date.png` | A product with Size M and L: only L is on backorder and only L has a box and a date. The public catalog gives M none and L its date. |

Registry backend (`npm run build`): 130,281 bytes on main 6a87a05, 130,438 with this change (634 free).
Merged locally with #309 (Tax) and #310 (audit fixes) as well: 131,026 bytes (46 free).

Data from 0.8.0 (stock status with no date, in the product's own data or in an older manual availability row)
loads, sells and saves as before: `tests/features/catalog/ship-date.test.mjs`, "products saved before ship dates".
