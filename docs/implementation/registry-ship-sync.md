# Orders and Ship's hosted service on Registry installs

Orders sends each paid order to Ship's hosted service and learns from Ship
when a label was bought. Ship buys and voids labels, keeps shipping statuses
and emails the shopper; Commerce keeps the order and its status. GrillTrack:
`commerce-ship-sync-001` and `commerce-allowed-hosts-ship-dinkuskit-com`
(the project owner's answers of 19:53 UTC 2026-10-10). The contract is
[section 3 of the handoffs](../contracts/commerce-handoffs.md#3-orders-to-inventory-and-ship-pack-and-ship-this).

## Configuration

The owner's `installedCheckout` configuration
(`dinkuskit.commerce.registry-checkout/v1`) takes an optional `ship` object
with exactly two fields, like `coupons`:

```json
{ "ship": { "origin": "https://ship.dinkuskit.com", "audience": "<Ship service audience>" } }
```

`origin` is a bare HTTPS origin. Ship is called with its own pass: once per
sync, Commerce trades the store key at DinkusKit.com for a `ship:orders` pass
with audience `ship.audience`
([store key and passes](installed-checkout-services.md#store-key-and-passes)),
from the same issuer as the Payments pass (same `iss` and `site_id`, at most an
hour old). Ship knows the store from the pass's `site_id`. Orders trades only
for this pass to talk to Ship, never for a Payments pass. Without `ship`, or
when the trade is refused (Ship turned off or cut off on DinkusKit.com
included), Orders calls nothing and works as before.

The manifest declares `network:request` with exactly `payments.dinkuskit.com`,
`coupons.dinkuskit.com`, `ship.dinkuskit.com` and `dinkuskit.com`. Declaring a host does not
activate it on any site.

## When Orders talks to Ship

A sync runs when the Orders page opens, after each change saved on the page
or through the agents' `orders` route, and on each background check (the
`commerce-checkout-wakes` task every 5 minutes, after Payments wakes;
[background check](installed-checkout-context.md#background-check)). Checkout never
calls Ship, and reading orders does not either. A sync that cannot reach Ship
leaves the page and the order as they are; the next sync carries on.

Each sync, in order (`src/features/orders/ship.ts`):

1. `GET /v1/labels`: labels Ship bought that Commerce has not acknowledged,
   at most 100 in at most 128 KB (read with the same bounded reader as
   Payments' answers), each `{ eventId, orderId, version, carrier, tracking }`.
   When the order is still Processing at that version, Orders completes it
   with Ship's carrier and tracking number, as if the owner had (the version
   goes up). A label for an older version (the owner fixed the address since), for
   a Completed order, with a carrier or tracking number Orders cannot keep, or
   for an order Orders does not have changes nothing. Each label is then
   acknowledged with `POST /v1/labels/ack` and `{ eventId }`, so a label seen
   again after a lost acknowledgement changes nothing.
2. `POST /v1/orders`: each order with a delivery address whose current version
   Ship has not taken, at most 10 per sync. The body is the
   `dinkuskit.commerce.ship-order/v1` record below. Any 2xx means Ship took
   it; 422 means Ship can never label this version (for example a destination
   it does not serve) and Orders waits for the order's next change; anything
   else is retried by the next sync. Orders records the version Ship took
   beside its copy (`shipVersion`) without raising the order's version.

```json
{
  "schema": "dinkuskit.commerce.ship-order/v1",
  "orderId": "order:demo", "number": 1001, "version": 1,
  "status": "processing", "test": true,
  "shipTo": { "name": "Demo Shopper", "line1": "1 Example Way", "city": "Testville", "region": "CA", "postalCode": "90000", "country": "US" },
  "email": "shopper@example.test",
  "completed": null,
  "lines": [{ "catalogItemId": "item_demo", "name": "Demo Mug", "quantity": 2, "unitPrice": { "currency": "USD", "minor": "1250" }, "weightOz": 12.5 }]
}
```

`lines` are the items that go in the box: digital items are left out. Each
line carries `unitPrice`, what the shopper paid for one of that item at
checkout as `{ "currency": "USD", "minor" }` with `minor` a whole number of
cents in a string (the paid order's line price, before any order-level
coupon; Registry stores take no coupons in v1), and the product's current
shipping weight in ounces when one is set, for insurance,
packing slips and later customs forms (GrillTrack `commerce-ship-sync-001`,
Ronald's "yes no no", 23:10 UTC 2026-10-10). `completed` is
`{ at, carrier?, tracking? }` once the order is Completed. `test` is true for
every order not taken in live mode; Ship must not buy postage for it. No order
totals, shipping charges, payment ids or phone numbers are sent. On
the first sync Ship gets every order with an address, including ones
completed long ago, a few per sync.

## Create shipping label

When the configuration names `ship` and a store key is saved, the page of
each Processing order with a delivery address shows a "Create shipping label"
link (GrillTrack `commerce-ship-label-link-001`). EmDash plugins cannot call
each other, so the link opens Ship's own label page for that order:

```text
<ship origin>/stores/<siteId>/orders/<orderId>
```

with the store id from the configuration and the order id, each
URL-encoded (`shipLabelPage` in `src/features/orders/ship.ts`). The link
carries no pass: Ship asks the owner to sign in with DinkusKit.com. Opening
the order makes no call and trades nothing, so whether Ship has the order, or
the store has Ship turned on, shows only on Ship's page. A Completed order
shows no link.

## Proof

- `tests/features/orders/ship.test.mjs`: what is sent and when (address
  fixes, Complete and Move back each send the new version; each line's price
  paid; no digital items, totals, payment ids or phone numbers), label
  outcomes for current, older,
  Completed, unusable and unknown orders, lost acknowledgements, Ship being
  down, 422, a missing pass, malformed label lists and the 10-per-sync limit.
- `tests/features/orders/status.test.mjs`: the Orders page syncs when it opens
  and after saved changes only, and a failing sync never breaks the page.
- `tests/integration/registry-checkout-services.test.mjs` (the last two
  tests, kept in this file so workerd starts one runtime at a time): the
  compiled Registry backend in workerd sends a paid physical order to a Ship
  stand-in with its own traded pass when Orders opens (with the Payments pass
  already expired), completes it from a label on the background check, tells
  Ship about an agent's change right away, and refuses a label list over
  128 KB without acknowledging or changing anything; without `ship`, with Ship
  turned off, or with a Payments pass handed out in its place, nothing calls
  Ship. The Processing order's page links to
  `<ship origin>/stores/synthetic-site/orders/<order id>` without calling Ship
  or trading, the Completed one does not, and without `ship` there is no link.
- `tests/features/orders/view.test.mjs`: the link comes first among a
  Processing order's actions, and never on the list, without Ship, without an
  address or on a Completed order.
- Registry backend: 127,780 → 129,752 bytes (+1,972), leaving 1,320 under
  131,072.
