# @dinkuskit/commerce

## 0.8.0

### Minor Changes

- [#243](https://github.com/dinkuskit/commerce/pull/243) [`ea8917f`](https://github.com/dinkuskit/commerce/commit/ea8917f7369ebd27d939714cad31f1b8973fba6b) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Commerce runs one build, the Registry build, everywhere (GrillTrack `commerce-one-build-registry-20261031`). The native entry drops its 24 routes the Registry build never had (`catalog-items/create`, `list`, `save-prices`, `save-media`, `set-sku`, `set-identifiers`, `rename`, `set-archived`, `add-variant-option`, `update-variant-labels`, `bulk-save-prices`, `set-backorders`, `set-manual-availability`, `set-regular-price`, `set-sale-price`, `clear-regular-price`, `clear-sale-price`, `set-feed-eligibility`, `configure-inventory`, `settings/storefront-availability`, `settings/out-of-stock-listing`, `settings/placeholder-image`, `settings/shipping-policy`, `settings/return-policy`) and its local Manage stock test aid (`enableLocalStockManagement`), with their route constants and route objects. Both builds now serve the same routes (the product panels, the private `catalog` route, the store's publish check, the public catalog reads, checkout and shopper accounts), bar the four only the Registry build registers: `store-proof`, `orders`, `checkout/guest/readiness` and `policies/public`. The CLI's `products list` sends `{op: "list"}` to the `catalog` route on every store.

- [#233](https://github.com/dinkuskit/commerce/pull/233) [`63acc14`](https://github.com/dinkuskit/commerce/commit/63acc14156716a5b0cd2a16fb0a18b6590ea5035) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Agents and the `dinkus-commerce` CLI can correct a Processing order's delivery address through the private `orders` route (`action: "address"`, `orders address`), with the Orders page's Correct address checks: at the confirmed order version, checked as checkout checks an address, only to a country the store ships to, never on a Completed order, and billing unchanged.

- [#240](https://github.com/dinkuskit/commerce/pull/240) [`79c0ef6`](https://github.com/dinkuskit/commerce/commit/79c0ef6d5ff1437427205c0f0939da2995230f18) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Staff with the EmDash Editor role can work Orders: the Orders page (inspect, Complete order, Move back to Processing, Correct address) and the private `orders` route for agents and the CLI. Connecting DinkusKit and checkout setup still need an Administrator.

- [#241](https://github.com/dinkuskit/commerce/pull/241) [`784b7bc`](https://github.com/dinkuskit/commerce/commit/784b7bcc552b1b9bb19354ba3864a2f97781f9e9) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Every product is made for its page. The catalog API's `create` now requires the page's `entryId` and refuses a page that already sells a product; the `link` op, the panel's "Sell it here" list and the "Products without a page" section in Commerce settings are gone. The CLI's `products create` finds or makes the Content > Products page by slug (`--slug`, default from `--name`), then makes the product for it; `products link` is removed.

- [#244](https://github.com/dinkuskit/commerce/pull/244) [`3affd43`](https://github.com/dinkuskit/commerce/commit/3affd43b5997c005f5a22fddf667492f332acb76) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The Dinkus Commerce panel is laid out like a Shopify product form. A page with no product opens on its price form (Regular, Sale, SKU, Stock status, a Physical product switch and Weight), and its first Save makes the product with those values; the "Add price and stock" button is gone. A linked page shows a status grid and cards: Pricing & stock, Variants, Shipping and Identifiers. The Variants card stays collapsed on a simple product and asks for an option name and comma-separated values; each variant is then its own card with Regular, Sale, SKU and Stock status. The SKU is editable in the panel. The words are options, values and variants: the catalog API's `choice` op is now `option`, `create` takes `fulfillment`, `regular`, `sale`, `stockStatus` and `weightOz` and answers with `created` and the price form, and the CLI's `add-choice` is `add-option`, its `--choice` flag `--variant`, and `products create` takes `--regular`, `--sale`, `--stock-status`, `--digital` and `--weight-oz`. All three ways of making a product call one kernel function, `createProductForPage`.

### Patch Changes

- [#228](https://github.com/dinkuskit/commerce/pull/228) [`d9da665`](https://github.com/dinkuskit/commerce/commit/d9da6650c9fde1888a6191cb80f9855524e1cb33) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Name the beta listing "DinkusKit Commerce (Beta)", the way Payments and Ship name theirs.

- [#231](https://github.com/dinkuskit/commerce/pull/231) [`6dee50c`](https://github.com/dinkuskit/commerce/commit/6dee50cdf5566ff775d879dad108cd60f0e028e6) Thanks [@saarius](https://github.com/saarius)! - Refuse catalog page links to missing products or choice IDs without replacing the page's current product selection.

- [#246](https://github.com/dinkuskit/commerce/pull/246) [`c83231a`](https://github.com/dinkuskit/commerce/commit/c83231ae6f4e8d18eaa9357d44a9d17c691a88f8) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - A checkout with only digital items no longer pays the flat shipping charge. Its frozen totals record shipping as free, so Payments adds no Shipping line. A basket with at least one physical item (an item with no fulfillment marked counts as physical) keeps the free or flat charge once per checkout, and Free shipping over still applies.

- [#248](https://github.com/dinkuskit/commerce/pull/248) [`2696b08`](https://github.com/dinkuskit/commerce/commit/2696b087bb1e37c1ad777446d2853518289fee2e) Thanks [@smoky-agent](https://github.com/apps/smoky-agent)! - Index stored `orders` rows by normalized `emailKey` (`emdash-plugin.jsonc` and `createPlugin()`) so `listOrdersForEmail` queries a shopper's orders by `{ emailKey }` plus a `{ emailKey: null }` fallback for pre-upgrade legacy rows instead of scanning all store orders, and seed the customer profile in `verifyShopperSignIn` before consuming the OTP challenge or persisting the session row.

- [#245](https://github.com/dinkuskit/commerce/pull/245) [`f8cf241`](https://github.com/dinkuskit/commerce/commit/f8cf24179afe77bb6fbe637b86f8877b326dd925) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The Registry backend is 1,980 bytes smaller with nothing changed for stores or merchants (GrillTrack `registry-headroom-20261031`): Rolldown inlines constants and tree-shakes more strictly, the Block Kit admin builds its fields through shared helpers, the Registry build reads stock management as managed or unmanaged only, and the ISO country set is a bit table. Headroom under the 131,072-byte cap goes from 826 to 2,806 bytes.

## 0.7.0

### Minor Changes

- [#204](https://github.com/dinkuskit/commerce/pull/204) [`b4b84fb`](https://github.com/dinkuskit/commerce/commit/b4b84fbb15cdf26a42f23580300adff486dbe630) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Commit catalog price, manual availability, submitted feed choices and multi-choice weight saves atomically within the default sandbox budget. Reject stale forms and distinguish a confirmed save from a failed panel refresh or unknown write outcome.
  
  Existing values are read through until saved into the product record. Direct kernel price, availability and feed readers require the catalog reader as their third argument. Older binaries must not write concurrently or be installed as a downgrade without a data conversion.

- [#213](https://github.com/dinkuskit/commerce/pull/213) [`390ab48`](https://github.com/dinkuskit/commerce/commit/390ab48b9aa153d5d65f22335f0750206e19e974) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Record a billing address on every checkout. Checkout contact accepts and requires `billing` (same shape and checks as `delivery`, any country, refused as `BILLING_INVALID`) and freezes it with the order. The Orders detail now shows the customer's email and phone, Ship to and Bill to ("Same as delivery address" when equal, "Not recorded" on older orders). The agents' `orders` route and `dinkus-commerce orders show` return `billTo` and `billToMatchesShipTo`. Storefronts must send `billing`; the template store's checkout form ships with this release.

- [#201](https://github.com/dinkuskit/commerce/pull/201) [`71b1595`](https://github.com/dinkuskit/commerce/commit/71b1595f47e210ed699f315ff86c5485aa40d8da) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Agents and tools can manage products through the private `catalog` route with an EmDash API token: list, get, create, link, prices and stock status, choices, SKU, weight, identifiers, archive, pictures and feeds, with the same checks as the product page panels. The `dinkus-commerce` CLI gains product commands on that route, each previewed with `--dry-run` and sent with the `--confirm` value it printed, which Commerce checks before it saves. A smaller Registry build makes room for it without removing anything.

- [#200](https://github.com/dinkuskit/commerce/pull/200) [`20b5196`](https://github.com/dinkuskit/commerce/commit/20b5196cf495aa1b6c5f2e1fc15100679766af3b) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Flat shipping can be free over an amount the owner sets in Set up Commerce at DinkusKit.com. Commerce asks DinkusKit.com for that amount and charges no shipping once an order's goods, after any discount, reach it.

- [#208](https://github.com/dinkuskit/commerce/pull/208) [`11d24e4`](https://github.com/dinkuskit/commerce/commit/11d24e49c0d5918222ea730f5387a92111ab6354) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Commerce keeps the link between a product page and its product, so a product page no longer needs a Commerce product field that people could type into. The Dinkus Commerce panel links the page without filling or saving anything on it, and stops asking for the `admin.editor-draft:patch` permission. `catalog-items/set-on-sale` takes the page alone and finds its product: a publish sells the panel's pick, and an unpublish, delete or title change acts on what the page last sold. The private `catalog` route's `get` takes a page's `entryId` to answer the product that page sells, Drafts included. The public catalog lists each product's `page`, and `catalog/public/item?pageId=` finds the product a published page sells, so a storefront reads the link from Commerce.
  
  Update the store's template with this release. A template that still reads the page's Commerce product field when it publishes keeps selling the pages that have it filled in, but a page linked in this panel would publish without going on sale.

- [#188](https://github.com/dinkuskit/commerce/pull/188) [`3846c70`](https://github.com/dinkuskit/commerce/commit/3846c709b7256ea76b65333fba574a8c0e33a59d) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The product page title is the product's one name. The store's publish check may send the page title as `name` with `catalog-items/set-on-sale`, and Commerce saves it in the same write that puts the product on sale, so the shop, cart, checkout and new orders show it. A write with `name` and no `onSale` only renames the product the page already sells, never changing whether it is for sale, so the store can catch up with a title that changed under an overlapping publish. The Dinkus Commerce panel no longer has its own Name field and Rename button.
  
  Update the store first: its publish check must send the title (dinkuskit/template-store#158) before it takes this release. A store that takes Commerce first keeps selling and keeps each product's current name until its store code is updated.

- [#196](https://github.com/dinkuskit/commerce/pull/196) [`73be237`](https://github.com/dinkuskit/commerce/commit/73be23713fc74ea86d51d9081900922428bccc19) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - A product page gets a second sidebar panel, "Product image & gallery", for the product's picture and up to eight gallery pictures from the Media Library, so they no longer sit at the bottom of the Dinkus Commerce panel. The Dinkus Commerce panel now says "Simple product. Add a choice, like Size, to sell it in more than one version." on a product with no choices. Store settings read the country list in less space; the accepted countries are unchanged.

- [#195](https://github.com/dinkuskit/commerce/pull/195) [`f9a5456`](https://github.com/dinkuskit/commerce/commit/f9a54561f73cc47d497aab51569b34407c5f9a2b) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The Dinkus Commerce panel tells the owner when a product has no Regular price. It says "Add a Regular price to sell it" under the state line, a published page's unpriced product reads "Published: off the shop" instead of "On sale", and a Save that leaves Regular empty answers with the same words as an info notice instead of "Product saved". Saving a choice's price with Regular empty answers the same. What is for sale does not change: a missing Regular price still keeps the product off the shop.

### Patch Changes

- [#198](https://github.com/dinkuskit/commerce/pull/198) [`f7c6071`](https://github.com/dinkuskit/commerce/commit/f7c6071b2cf6c6dde95c1bb0840cacafa12fa6aa) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - When the site scheduler hangs long enough for a second try to start, a late failure from the first try no longer makes Commerce forget that the second try registered its 5-minute background check. Switching Commerce on still forgets any earlier registration and writes the check again.

- [#183](https://github.com/dinkuskit/commerce/pull/183) [`28dd633`](https://github.com/dinkuskit/commerce/commit/28dd6338d90b0cba48d9b61e1849453f400d5d17) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Guard catalog price updates and clears with `getVersioned`, `compareAndSet`, and `compareAndDelete` retries so concurrent Regular and Sale edits revalidate invariants and never clobber sibling fields.

- [#209](https://github.com/dinkuskit/commerce/pull/209) [`501bc9a`](https://github.com/dinkuskit/commerce/commit/501bc9aa58c914a12a6d9e4b492754350632d183) Thanks [@saarius](https://github.com/saarius)! - Fail closed when a requested CLI configuration profile is missing or malformed. Inherited JavaScript property names no longer count as defined profiles, and selected profiles/maps must be JSON objects before any HTTP request. This prevents a malformed selection from silently dispatching an authenticated change to the base site. Explicitly defined names, valid overrides, configuration precedence, and project-config credential restrictions are unchanged.

- [#210](https://github.com/dinkuskit/commerce/pull/210) [`08483da`](https://github.com/dinkuskit/commerce/commit/08483dade447e31b223969fd30eded51f48e81da) Thanks [@saarius](https://github.com/saarius)! - Report CLI timeouts and dropped connections while reading a response body as transport failures (exit 3), not internal errors (exit 5). Keep raw transport exceptions, including request-level abort errors, out of command output and do not retry possibly applied writes.

- [#216](https://github.com/dinkuskit/commerce/pull/216) [`9655633`](https://github.com/dinkuskit/commerce/commit/9655633ed806e2fa81e8bae6cecadef692d296c6) Thanks [@saarius](https://github.com/saarius)! - Report an unknown outcome (exit 3) when Ctrl-C interrupts a catalog or order change after dispatch starts, instead of falsely saying nothing was sent (exit 4). Read-only preflights, blocked requests and already-cancelled changes do not mark a write as sent.

- [#182](https://github.com/dinkuskit/commerce/pull/182) [`4e15ae5`](https://github.com/dinkuskit/commerce/commit/4e15ae51a49428e6235286a1e2a684f33a86df72) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Deduplicate site-scope origin resolution, guest capability header parsing, catalog route error translation, and redundant catalog/coupon helpers to reclaim Registry `backend.js` bundle headroom.

- [#223](https://github.com/dinkuskit/commerce/pull/223) [`6871875`](https://github.com/dinkuskit/commerce/commit/6871875ca54fd526c02dbd3b374622d7cfb24eb0) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Build and test against EmDash 1.4.0. The runtime peer and the recorded EmDash compatibility move to exact `emdash` 1.4.0. The Registry bundle is byte-for-byte unchanged; the reference article now says Commerce requires EmDash 1.4.0.

- [#207](https://github.com/dinkuskit/commerce/pull/207) [`1d20f26`](https://github.com/dinkuskit/commerce/commit/1d20f263221fff0d578d7704119921df76ae8d1d) Thanks [@saarius](https://github.com/saarius)! - Reject malformed explicit Payments readiness flags before creating a payment session, matching the existing readiness check. Continue accepting successful bindings without a readiness flag and allow historical lookup when current payment creation is not ready.

- [#225](https://github.com/dinkuskit/commerce/pull/225) [`bde1b17`](https://github.com/dinkuskit/commerce/commit/bde1b17699d2607997bec93109dd129c3e8a32dc) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Improve the EmDash Registry listing with DinkusKit branding, website and documentation links, search keywords, setup guidance, and real demo screenshots.
  
  Carry checksummed listing media through the delegated release flow with no-clobber GitHub release assets and post-publication image verification.

- [#226](https://github.com/dinkuskit/commerce/pull/226) [`59b8e5d`](https://github.com/dinkuskit/commerce/commit/59b8e5d83342221874ce3d53b26dd32e4209f407) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Publish the Registry icon and screenshots through the EmDash release-action
  from emdash-cms/emdash#4467, so a new release carries its listing artwork.

- [#215](https://github.com/dinkuskit/commerce/pull/215) [`a484f0f`](https://github.com/dinkuskit/commerce/commit/a484f0fd5208e48654c849a2716586db869aad1e) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Remove the "Allowed selling/customer countries" box from Commerce settings. Nothing enforced it; checkout only checks shipping destinations. Saved lists stay stored so older records and seeds still load, and a stale form that still sends the box is ignored.

- [#181](https://github.com/dinkuskit/commerce/pull/181) [`706e5e9`](https://github.com/dinkuskit/commerce/commit/706e5e9b9b2174c34b5a7a28737cd7a3cc96ba9f) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Retry storage compare-and-set races on non-owner order metadata (`shipVersion`, `number`) in `change()` before reporting contention so Ship label sync never acknowledges a label without persisting order completion.

- [#211](https://github.com/dinkuskit/commerce/pull/211) [`2370818`](https://github.com/dinkuskit/commerce/commit/2370818b0c5d6b50eb4160ad5cd2933e9b8f1dd4) Thanks [@saarius](https://github.com/saarius)! - Correct merchant settings guidance to distinguish physical shipping-destination checks from the selling/customer list, which checkout does not enforce. Align the settings documentation with the existing checkout contact requirements. Checkout policy and persisted settings are unchanged.

## 0.6.0

### Minor Changes

- [#180](https://github.com/dinkuskit/commerce/pull/180) [`63f3e17`](https://github.com/dinkuskit/commerce/commit/63f3e17ea78f1ebe276d05ce5e77d297921da87f) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - One product screen: each Content > Products page gets a Dinkus Commerce editor panel with price, sale price, SKU, sizes, stock, weight and photos, plus "Add price and stock", which makes a Draft product and links it to the page without saving the page. The Commerce Products page is gone; Commerce settings lists products without a page, each with Make a page. New products start as a Draft (off the shop) until the store's publish check calls the private `catalog-items/set-on-sale` route; restoring an archived product returns it to Draft. Commerce pages sit in a "Dinkus Commerce" sidebar folder, and Settings is labelled "Commerce settings". Admin is Block Kit only: native installs get the same Orders and Commerce settings pages and product page panel as Registry stores, and the React Products, Store and Coupons screens, the `@dinkuskit/commerce/admin` export and the `react` peer dependency are removed. Coupon records stay in storage.

### Patch Changes

- [#173](https://github.com/dinkuskit/commerce/pull/173) [`7632cab`](https://github.com/dinkuskit/commerce/commit/7632cab43389c78045aac62a719d1218cd271c54) Thanks [@smoky-agent](https://github.com/apps/smoky-agent)! - Allow products to hold up to three variant-defining options (such as `Size × Color`), up to fifty values per option, and up to fifty sparse or full variant members with explicit existing-member assignments when appending options, revision-fenced option/value label renaming across options, and native + Registry editor support.

## 0.5.0

### Minor Changes

- [#170](https://github.com/dinkuskit/commerce/pull/170) [`1d6bb4c`](https://github.com/dinkuskit/commerce/commit/1d6bb4ccbf4475e6e19d21e366729508d9a0241d) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Connect to DinkusKit replaces pasting the checkout settings and the store key: an Administrator presses Connect on Commerce Settings, the business owner approves at DinkusKit.com, and Commerce gets its own store key, kept encrypted. Commerce connects first; Payments and Ship join the store it makes. Commerce fetches its checkout settings from DinkusKit.com itself, after Connect, on Get checkout settings and on every background check. The Checkout settings and Store key boxes are gone.

### Patch Changes

- [#169](https://github.com/dinkuskit/commerce/pull/169) [`8064ddf`](https://github.com/dinkuskit/commerce/commit/8064ddfa2449dab62875086d0c436d067bc567c5) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The Registry build leaves out checkout's coupon quoting, reservation and reconciliation, which it cannot reach without a coupon port, freeing about 5.6 KB under the Registry's per-file size limit. A coupon code is refused exactly as before; the native entry keeps every coupon path.

- [#168](https://github.com/dinkuskit/commerce/pull/168) [`8dac3cf`](https://github.com/dinkuskit/commerce/commit/8dac3cf8fd29ab143c8c753be45c1125e11d7126) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The Registry build leaves out the Manage stock, stock reservation and order Pack paths it cannot reach, freeing about 6.9 KB under the Registry's per-file size limit. Nothing a Registry store can do changes; the native entry keeps every path.

## 0.4.0

### Minor Changes

- [#151](https://github.com/dinkuskit/commerce/pull/151) [`18f0c19`](https://github.com/dinkuskit/commerce/commit/18f0c196ed71ac74a532fd9d9d650860b9ab70fb) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Add a host-only `buildProductPreviewJsonLd` helper for editorial product pages
  without a Commerce item. It emits only supplied page facts and never invents
  identifiers, price, availability, or an Offer.
  
  Expose existing merchant-approved feed channels on public catalog list and
  item responses so storefront hosts can build public feeds without admin
  reads. Missing or empty eligibility never opts a product in.

- [#143](https://github.com/dinkuskit/commerce/pull/143) [`952b5b9`](https://github.com/dinkuskit/commerce/commit/952b5b984cc966b2f1e3ba33ae9b0e02ea8f8286) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Require Node 24 (engines `>=24.15.0 <25`); Node 22 has critical SQLite bugs. The repository pins Node 24.22.0. To move an existing Node 22 install, switch to Node 24.15 or newer, then reinstall from the lockfile with `npm ci`: native modules built for Node 22, such as better-sqlite3, fail to load under Node 24 until they are reinstalled.

- [#152](https://github.com/dinkuskit/commerce/pull/152) [`c42597b`](https://github.com/dinkuskit/commerce/commit/c42597bddd35d949f4e69f8ca97cc26206200da0) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Add store-local shopper accounts (`dinkus.customers`) with passwordless 6-digit email OTP sign-in (`email:send`), origin-bound `x-commerce-customer-session` capability tokens, automatic case-folded email linking to past and future paid orders, and a single default saved shipping address + optional phone.

- [#161](https://github.com/dinkuskit/commerce/pull/161) [`2d51753`](https://github.com/dinkuskit/commerce/commit/2d51753b0c43bf4663bf429f437793d0e6f502b4) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Require a supported US state or District of Columbia for new physical checkouts to the United States. Accept abbreviations and full names while preserving merchant-configured non-US destinations, saved addresses and existing checkout attempts.

### Patch Changes

- [#157](https://github.com/dinkuskit/commerce/pull/157) [`eebeca0`](https://github.com/dinkuskit/commerce/commit/eebeca0fc2e8dff8c8d3642e525ad1303dc979a8) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Recover the 5-minute background check when the site scheduler fails or stalls
  while Commerce is switched on. Switching on now gives the scheduler 3 seconds
  and never fails the hook; until the check is registered, the next request
  registers it, at most one attempt a minute per isolate, so payments a shopper
  never returned from and Ship labels are still picked up without switching the
  plugin off and on.

- [#159](https://github.com/dinkuskit/commerce/pull/159) [`75e90a3`](https://github.com/dinkuskit/commerce/commit/75e90a33cee3d226a2ff16bbad9ea2c4398e3c1a) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Shrink the Registry plugin file by 1,457 bytes with no change in behavior.
  Shopper accounts, guest checkout and the Inventory Pack button now share one
  copy of the same-origin request check and the secret hashing helpers, and the
  shopper account handlers, routes and error table are written once instead of
  five times.

## 0.3.0

### Minor Changes

- [#129](https://github.com/dinkuskit/commerce/pull/129) [`6f4d293`](https://github.com/dinkuskit/commerce/commit/6f4d2935fb899420c02c63569f1923d4c23b071e) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Store owners can rename a product, archive it (it leaves the shop and checkout refuses it) and restore it, and copy its product ID from the product's admin page. Past orders keep the name the product had when bought.

### Patch Changes

- [#135](https://github.com/dinkuskit/commerce/pull/135) [`cb8ba5e`](https://github.com/dinkuskit/commerce/commit/cb8ba5e94857e8e7f1e5b0a7dbcfc62d9471d078) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Product admin screens no longer fail with "Too many subrequests" once a store has more than a handful of products. The Products list reads only names, and each product screen and its saves read that one product directly, with prices and stock in one batched call, so a screen costs the same few storage calls with 10 products or 1,000, archived products included.

- [#137](https://github.com/dinkuskit/commerce/pull/137) [`5a449ec`](https://github.com/dinkuskit/commerce/commit/5a449ec7d127152f65dbd56d5b2e4ef74c71cb02) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The shop's product list no longer fails with "Too many subrequests" once a shop has more than a couple of live products. Each page reads prices, stock and photo records for all its products in a few batched calls, and a page stops early once its photos would take more than 16 Media Library reads, with the next cursor picking up at the next product. One product's page reads each record once. The cursor stays opaque; follow it until it is absent, as before.

- [#125](https://github.com/dinkuskit/commerce/pull/125) [`d86690d`](https://github.com/dinkuskit/commerce/commit/d86690d4ba05d2e0f636b83c118bdfe8f219e23c) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Commerce's 5-minute background check now gets 25 seconds instead of EmDash's default 5, so it reaches Ship, collects labels and marks orders Completed on Registry stores without anyone opening Commerce Orders.

- [#133](https://github.com/dinkuskit/commerce/pull/133) [`82837f7`](https://github.com/dinkuskit/commerce/commit/82837f75ce0199b263b06d4e150b7535289b8017) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Commerce asks only for DinkusKit's own hosts: payments, coupons and ship under dinkuskit.com, and dinkuskit.com itself. The isolated Ship TEST profile from 0.3.0-beta.0 and its test host `ship.sm0ky.dev` are gone, including the private Orders actions `ship.admit` and `cohort.disable`. A store whose checkout settings still name that profile keeps checkout and simply has no Ship until it is set up with Ship at ship.dinkuskit.com, which every store uses.

- [#116](https://github.com/dinkuskit/commerce/pull/116) [`01b907a`](https://github.com/dinkuskit/commerce/commit/01b907a2be1374b0a90b252682677acbc9348e47) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Support the separately published beta package's exact Registry installation identity while preserving stable and unknown-identity admission rules.

## 0.3.0-beta.4

### Patch Changes

- [#135](https://github.com/dinkuskit/commerce/pull/135) [`cb8ba5e`](https://github.com/dinkuskit/commerce/commit/cb8ba5e94857e8e7f1e5b0a7dbcfc62d9471d078) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Product admin screens no longer fail with "Too many subrequests" once a store has more than a handful of products. The Products list reads only names, and each product screen and its saves read that one product directly, with prices and stock in one batched call, so a screen costs the same few storage calls with 10 products or 1,000, archived products included.

- [#137](https://github.com/dinkuskit/commerce/pull/137) [`5a449ec`](https://github.com/dinkuskit/commerce/commit/5a449ec7d127152f65dbd56d5b2e4ef74c71cb02) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The shop's product list no longer fails with "Too many subrequests" once a shop has more than a couple of live products. Each page reads prices, stock and photo records for all its products in a few batched calls, and a page stops early once its photos would take more than 16 Media Library reads, with the next cursor picking up at the next product. One product's page reads each record once. The cursor stays opaque; follow it until it is absent, as before.

## 0.3.0-beta.3

### Patch Changes

- [#133](https://github.com/dinkuskit/commerce/pull/133) [`82837f7`](https://github.com/dinkuskit/commerce/commit/82837f75ce0199b263b06d4e150b7535289b8017) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Commerce asks only for DinkusKit's own hosts: payments, coupons and ship under dinkuskit.com, and dinkuskit.com itself. The isolated Ship TEST profile from 0.3.0-beta.0 and its test host `ship.sm0ky.dev` are gone, including the private Orders actions `ship.admit` and `cohort.disable`. A store whose checkout settings still name that profile keeps checkout and simply has no Ship until it is set up with Ship at ship.dinkuskit.com, which every store uses.

## 0.3.0-beta.2

### Minor Changes

- [#129](https://github.com/dinkuskit/commerce/pull/129) [`6f4d293`](https://github.com/dinkuskit/commerce/commit/6f4d2935fb899420c02c63569f1923d4c23b071e) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Store owners can rename a product, archive it (it leaves the shop and checkout refuses it) and restore it, and copy its product ID from the product's admin page. Past orders keep the name the product had when bought.

## 0.3.0-beta.1

### Patch Changes

- [#125](https://github.com/dinkuskit/commerce/pull/125) [`d86690d`](https://github.com/dinkuskit/commerce/commit/d86690d4ba05d2e0f636b83c118bdfe8f219e23c) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Commerce's 5-minute background check now gets 25 seconds instead of EmDash's default 5, so it reaches Ship, collects labels and marks orders Completed on Registry stores without anyone opening Commerce Orders.

## 0.3.0-beta.0

### Minor Changes

- [#117](https://github.com/dinkuskit/commerce/pull/117) [`ef2fabe`](https://github.com/dinkuskit/commerce/commit/ef2fabe429675b88cee90521616e32c0e81a310b) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Add an isolated Ship TEST profile with explicit owner admission, permanent recipient pins, and atomic cohort disable fencing for completion and acknowledgements. Preserve production configuration and existing paid orders.

### Patch Changes

- [#116](https://github.com/dinkuskit/commerce/pull/116) [`01b907a`](https://github.com/dinkuskit/commerce/commit/01b907a2be1374b0a90b252682677acbc9348e47) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Support the separately published beta package's exact Registry installation identity while preserving stable and unknown-identity admission rules.

## 0.2.2

### Patch Changes

- [#113](https://github.com/dinkuskit/commerce/pull/113) [`21be3e5`](https://github.com/dinkuskit/commerce/commit/21be3e51218cfbe0353296a1811837a07cc8d59a) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Allow a prepared guest checkout to resume on the same capability after validation rejects a start before an attempt is saved. Status confirms the absence without creating a payment session; explicit attempt hints, storage failures, and existing attempts retain their current safeguards.

## 0.2.1

### Patch Changes

- [#111](https://github.com/dinkuskit/commerce/pull/111) [`09e43c8`](https://github.com/dinkuskit/commerce/commit/09e43c856d8db29517c661597215aefc317b7370) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Recognize successful Payments checkout-binding responses without a wire `ready` field, so Registry checkout readiness can become supported after the store is configured. Preserve binding identity, provider, account, mode, and refusal checks.

- [#109](https://github.com/dinkuskit/commerce/pull/109) [`b54cac9`](https://github.com/dinkuskit/commerce/commit/b54cac9f70b3356c605e2ac94d8f1e9a2ab77ddb) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Shrink the sandboxed plugin bundle from 130,990 to 114,334 bytes (82 bytes of headroom under the 131,072-byte Registry per-file limit, now 16,738) by sharing frequent member-access property names through the build's existing literal-sharing bindings. No behavior changes.

## 0.2.0

Baseline release. Published to the EmDash Registry by hand before the
Changesets release process landed, and recorded here so generated release
notes start from the version that matches the Registry.
