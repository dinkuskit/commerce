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
`from`, `ref` and codes of all answers together are at most 1,500 characters.
The order keeps those, and its `order.paid` news must stay under the courier's
8 KB beside the longest address Commerce takes (about 6.5 KB at most).
Any other key, or a value out of bounds, leaves checkout unavailable before
anything is frozen. Sales tax will add its own keys when the Tax plugin is
built; until then they are refused.

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
- A checkout whose payment is open keeps its add-ons' `from` and `codes` frozen
  with its cart: other codes, or none, answer `CHECKOUT_FROZEN`; the same codes
  replay it (the reference may differ).

## What is kept

The attempt and its order keep `addons: [{ from, ref, codes }]`. Orders shows
the codes on the discount line ("Discount SAVE10"). The courier's `order.paid`
news carries `discount` whenever it is above 0, and `addons`, so the Coupons
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
