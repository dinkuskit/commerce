# Store sidebar folder (admin-one-store-folder-128)

Step (a) of `store-connect-order-135` in dinkuskit/dinkuskit. Commerce, Payments
and Ship carry `group: "Store"` on their admin pages, and the template store
gives its `products` and `categories` collections the same group, so EmDash
1.4.0 shows one Store folder. The pictures cover all four PRs: this one,
dinkuskit/payments#120, dinkuskit/ship#99 and dinkuskit/template-store#250.

## How they were taken (22 Nov 2026)

`astro dev` (Node, SQLite) on the template store, with this branch's Registry
build mounted through `sandboxed: [...]` (as `DINKUS_PAIRED_COMMERCE_DIR`
does), and the Payments and Ship branches packed with the official Registry
packager (`bundlePlugin`) and mounted the way the playground mounts packed
plugins. Setup through `/_emdash/api/setup/dev-bypass`, sign-in through
`/_emdash/api/auth/dev-bypass`, pictures with Playwright (desktop 1280 wide at
2x, phone as Playwright's iPhone 13).

## A fresh store

- `fresh-store-folder.png`: a store made from the template branch's seed. The
  Content section has one Store folder: Product categories, Products, Payment
  settings, Shipments, Orders, Commerce settings.
- `fresh-payment-settings.png`: Payment settings opens from that folder at its
  usual `/status` address.

## An existing store upgrading

1. A store made and set up on template-store main 84dfaf8 (its seed and its
   self-upgrade steps 001 to 005), 5 products and 3 product categories. The
   owner had put Product categories in a folder of their own, "Catalog"
   (set in `_emdash_collections.nav_group`, the column EmDash's group setting
   writes).
2. `upgrade-1-before.png`: on main, Catalog holds Product categories, and
   Products sits loose under Content.
3. The same database, now run on the template branch (3ef68df). The first
   storefront request ran `006_store_folder`
   (`dinkus:storefront-upgrades` now ends `005_commerce_box_off`,
   `006_store_folder`).
4. Read from the database afterwards: `products` group `Store`, `categories`
   group still `Catalog`, `pages` none; still 5 products and 3 product
   categories. The home page, `/categories/hats`, `/categories/tees`,
   `/products/ribbed-beanie-preview` and `/products/boxy-tee-preview` answer 200.
5. `upgrade-2-after.png` (desktop) and `upgrade-3-after-phone.png` (phone menu
   open): Products joined the Store folder with the plugin pages; the owner's
   Catalog folder is untouched.
