# @dinkuskit/commerce

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
