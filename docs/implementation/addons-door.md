# The add-ons door

GrillTrack `commerce-addons-door-20261124`, which supersedes
`commerce-addons-door-20261022`. The owner approved the design on 24 Nov 2026.

## Why

EmDash plugins cannot call each other. Coupons (and, later, sales tax) are their
own Registry plugins, and the Registry backend has to fit EmDash's 128 KiB
per-file limit, so Commerce carries no coupon logic. Instead the store's own
code, which can call every plugin's private routes with nobody signed in, asks
each add-on first and hands their answers to one private Commerce route.

## Route

`POST checkout/addons/start`: private (`plugins:manage`), with the same declared
headers as the public guest routes (cart capability, `origin`,
`sec-fetch-site`). A call with a signed-in user, the Administrator included, is
refused with `STORE_ONLY` (as `courier/outbox` refuses with `COURIER_ONLY`), so
only the store itself can use it. It runs exactly what `checkout/guest/start`
runs, and that public route refuses `addons` as `INVALID_CART`.

Input: `{ contact?, news?, addons }`, where `addons` holds 1 to 4 answers with
distinct `from`:

| Field | Meaning | Bound |
| --- | --- | --- |
| `from` | the add-on's plugin id | 1 to 64 characters |
| `ref` | the add-on's own reference, such as a hold id | 1 to 200, optional |
| `codes` | the codes the shopper typed | at most 6, each 1 to 64, optional |
| `ship` | `"free"` waives shipping | optional |
| `lines` | `[{ item, price, qty, off }]` for every checkout line, in Commerce's line order (cart lines sorted by catalog item id) | at most 100 |

`price` and `off` are whole cents as decimal strings, at most 1,000,000,000.
`from`, `ref`, codes and `item` are printable ASCII (`!` to `~`), and the
`from`, `ref` and codes of all answers together are at most 1,500 characters as Commerce writes them (a JSON list of `[from, ref, codes]`, quotes, commas and brackets included), so the bound is a little tighter than the bare strings.
The order keeps those, and its `order.paid` news must stay under the courier's
8 KB beside the longest address Commerce takes (about 6.5 KB at most).
Any other key, or a value out of bounds, leaves checkout unavailable before
anything is frozen.

A tax answer (dinkuskit/tax ledger `shared-addons-door`, `tax-picks-rate-commerce-does-math`
and `round-per-line-half-up`, which the owner approved on 24 Nov 2026) adds:

| Field | Meaning | Bound |
| --- | --- | --- |
| `to` | the address it priced: `line1`, `line2`, `city`, `region`, `postalCode`, `country` of the delivery address (billing when nothing ships), as Commerce normalizes them, joined with `\n` (an absent field is empty) | must equal Commerce's own |
| `shipRate` | shipping's rate in millionths | `0` to `999999`, required with `to` |
| `lines[].rate` | each line's rate in millionths | `0` to `999999`, required on every line with `to`, refused without it |

## What Commerce checks

- Every answer names every line with the item, unit price and quantity Commerce froze.
  A different one means the catalog or the cart changed after the store asked:
  `CONTENTION`, and the store asks the add-on again.
- The amounts off on one line, from all answers, never exceed that line's
  subtotal, so no line goes below $0.
- Commerce does the sums itself: the discount per line, `couponDiscount` as
  their total, `netMerchandise`, then shipping. Free shipping over the owner's
  amount is judged on `netMerchandise`; an answer with `ship: "free"` makes the
  charge 0 and the mode `free`. The pricing snapshot keeps its v1 shape, so
  Payments needs no new schema.
- Tax comes after the discounts. A tax answer whose `to` is not the checkout's
  own address is `CONTENTION`. Each line's tax is `(net × rate + 500,000) ÷
  1,000,000` in whole cents (once per line, halves up); shipping's is the same
  on the charge with `shipRate`. Rates from several answers add up before
  rounding. With a tax answer the snapshot adds `tax` (lines' plus shipping's)
  and `lines[].tax`, and `finalTotal` is `netMerchandise + shipping + tax`;
  without one neither key is written, so a Payments service that knows no tax
  takes it unchanged, and one that does not know tax refuses a taxed checkout
  rather than charging less.
- A checkout whose payment is open keeps its add-ons' `from` and `codes` frozen
  with its cart: other codes, or none, answer `CHECKOUT_FROZEN`; the same codes
  replay it (the reference may differ).

## What is kept

The attempt and its order keep `addons: [{ from, ref, codes }]`; a tax
answer's address and rates are not kept (Tax keeps its match level and its
owner-typed flag in its own records, under its `ref`). Orders shows
the codes on the discount line ("Discount SAVE10"). The courier's `order.paid`
news carries `discount` whenever it is above 0, `tax` (null when untaxed), and `addons`, so the Coupons
plugin turns its hold into a use when the order is paid, including a payment
that arrives after the checkout ended.

## Tests

- `tests/integration/registry-checkout-services.test.mjs`: the compiled Registry
  runtime in workerd, through the door: refusal of add-on answers at the public
  start, price mismatch, bounds, the priced Payments request, frozen replay, the
  order and Orders' copy keeping the add-ons, free shipping, two answers adding
  up, and a fully discounted order paid without Payments.
- `tests/features/orders/courier-outbox-runtime.test.mjs`: `STORE_ONLY` for a
  signed-in caller through EmDash's own dispatch, and `order.paid` naming the
  discount and the add-ons.
- `tests/features/checkout/checkout-pricing.test.mjs`: pricing, bounds and the
  Payments adapter's arithmetic checks.
