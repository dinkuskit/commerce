# Cart attributes (commerce#312)

GrillTrack `commerce-cart-attributes-order-paid-20261123`, locked by the owner on 24 Nov 2026.

## What is stored, and what is not

Attributes add three optional fields and change no existing one:

- on the cart record, `attributes` beside `cart` and `attempts`
- on a checkout attempt, `attributes`
- on the paid order, `attributes`

A record written before this build has none of them. Nothing is migrated, no index changes, and no setting is written. The courier's `order.paid` item gains `attributes`, `null` for an order without them.

## Stored data from Commerce 0.8.0 after the upgrade

`tests/upgrade/cart-attributes-upgrade.test.mjs` runs two compiled Registry runtimes, one after the other, against one SQLite database ([upgrade-trace.txt](upgrade-trace.txt)). The first is Commerce v0.8.0's own build, from its tag with its own lockfile. The second is this branch's build. Payments is the synthetic Payments from `tests/features/checkout/registry-runtime.mjs`.

1. **On 0.8.0.** A shopper started checkout for the $2.50 hat and reached the payment page (`phase: paying`). The cart record and its attempt carry no `attributes`.
2. **On this build, same database.**
   - The saved checkout setting read back exactly as 0.8.0 left it.
   - The shopper's 0.8.0 cart key still read that checkout, and the cart it returned had no `attributes`.
   - Adding attributes to that open checkout answered `CHECKOUT_FROZEN`, as any change to a frozen cart does.
   - Payments answered paid for the session 0.8.0 saved. The order was made, `order:<attemptId>`, $2.50, and both the attempt's order and the copy Orders keeps have no `attributes`.
3. **A new shopper, same database.** The cart took `{ account_id, credit.sku }`, checkout start froze them onto the new attempt, and the 0.8.0 cart record was left as it was. The database then held both carts.

The neighbouring `payment-window-upgrade.test.mjs` passes on this build too: a checkout open on 0.8.0's payment page is paid after the upgrade, and a new shopper checks out on the kept settings.

Run both with `COMMERCE_UPGRADE_FROM_SANDBOX=<v0.8.0 checkout>/dist/sandbox node --test tests/upgrade/*.test.mjs`. Without that variable they are skipped.

## The whole store, upgraded through EmDash

`COMMERCE_UPGRADE_FROM=v0.8.0 COMMERCE_UPGRADE_SPEC=registry-upgrade-cart-email.spec.mjs npm run test:registry-upgrade` answered `registry_upgrade=pass from=v0.8.0 phases=old,bridge,new` ([registry-upgrade-trace.txt](registry-upgrade-trace.txt)). A Registry-shaped store ran Commerce 0.8.0 on that release's own EmDash, where a shopper got a cart key, left an unpaid checkout, and the owner saved a catalog setting. This build then ran on 0.8.0's EmDash, and after that on this checkout's EmDash against the same database: in both, the 0.8.0 cart and setting were as 0.8.0 left them.

## Orders with and without attributes in the paid news

`tests/features/orders/courier-outbox-runtime.test.mjs`, through the compiled Registry bundle in an in-process EmDash runtime:

- an order whose cart carried attributes gives them in `order.paid`
- an order whose cart carried none gives `attributes: null`
- the largest paid news (longest address in a three-byte script, four full add-on answers, a 985-byte attribute bag, one item listed) measures 7,490 bytes, under the 7,500 bytes at which the item list gives way and the courier's 8 KB limit

## Limits and refusals

`tests/features/checkout/server-cart.test.mjs`: 11 attributes, a bag just over 1,000 bytes, a reserved or malformed name, a non-text or over-long value, and attributes sent without a cart replace are each refused as `INVALID_CART` with nothing saved. A replace that names attributes replaces them, one that names none keeps them, `{}` clears them. The payment request and the guest receipt never carry them.
