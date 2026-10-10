# Commerce handoffs

Commerce is three areas: **Catalog** (products, prices, whether an item can be
sold), **Checkout** (cart, totals, payment handoff) and **Orders** (paid orders,
packing, shipping). Payments, Inventory and Coupons are hosted services
outside the plugin. This document names the three messages that cross between
the areas, so each area can change on its own and the same messages survive
however Commerce is packaged later.

## Why the messages come first

Commerce's Registry backend has to fit EmDash's per-file limit. Two later
directions are open, and they differ only in how the areas talk:

| Packaging | How a handoff travels |
| --- | --- |
| One Registry plugin (today, or a raised size limit) | a plain function call inside the plugin |
| Separate Registry plugins | the same message posted across plugins (for example a content entry another plugin's save hook answers), or a future upstream plugin-to-plugin channel |

The message shape, its validation and the rule for repeats are the same in
every row. Only the transport changes, so code written against these messages
carries over whichever way Commerce goes.

## The rule each area follows

- An area reads and writes only its own storage. The feature audit
  (`npm run audit:features`, `scripts/check-features.mjs`) fails when a file
  names another feature's Registry storage collection or imports another
  feature's private files instead of its `index.ts`.
- The composition roots (`src/plugin.ts`, `src/index.ts`) and the admin shell
  (`src/admin/`) wire areas together. Under a split each admin page moves with
  its area and each plugin gets its own small shell.
- Message types live in `src/handoffs/`, which every area may import. Both
  sides validate what they receive.

## 1. Catalog to Checkout: the basket quote

Checkout asks once per basket; Catalog answers.

- **Request:** the cart's catalog item ids, in cart order.
- **Reply** (`CatalogQuote`, `src/handoffs/catalog-quote.ts`): for each item
  its name, the price the customer pays now, its option choices when it is one
  choice of a product with options, and, when Inventory tracks it, the
  Inventory SKU and whether backorders are allowed. When any item is tracked,
  the reply also carries the store's Inventory binding. If an item cannot be
  sold the reply is a refusal with the first reason: `unavailable`,
  `unpriced`, `inventory-setup` or `inventory-unavailable`.
- **Where:** `quoteCatalogBasket` in `dinkus.storefront-availability`, which
  owns the sellable-or-not answer. Checkout freezes the reply into its attempt
  and never reads catalog storage for pricing again.
- **Under a split:** a same-moment request and reply. Checkout waits for the
  answer before it freezes the basket.
- **Known crossing still open:** Checkout's runtime binds the Catalog-side
  storage collections that answer the quote (`src/features/checkout/runtime.ts`,
  listed in the audit's `KNOWN_STORAGE_CROSSINGS`). A split moves that binding
  into the Catalog plugin; the audit list may only shrink.

## 2. Checkout to Orders: the paid order

Checkout sends one record when it records an order as paid. Locked as
GrillTrack decision `commerce-paid-order-handoff-001`.

- **Message** (`PaidOrder`, schema `dinkuskit.commerce.paid-order/v1`,
  `src/handoffs/paid-order.ts`): order id, receipt id, checkout attempt id,
  provider payment id when a provider took the payment, when Checkout recorded
  the payment (absent on orders paid before this field existed), the frozen
  lines (catalog item id, quantity, name, unit price), the order total, the
  frozen pricing snapshot when present, option choices, Inventory ticket ids
  when reserve returned them, and the frozen shopper contact. For a basket
  with a physical item the contact carries the delivery address
  (`contactSnapshot.contact.delivery`, commerce#33); digital-only orders and
  orders paid before addresses were collected have none.
- **Receiving:** Orders keeps it under the order id as its own copy
  (`orders` collection, record `{ paidOrder }`). A repeat with the same
  contents is a no-op (`duplicate`); different contents are refused and the
  first copy is kept (`conflict`). Later order facts (packed, shipped,
  refunded, notes) belong to Orders beside the copy, never back in Checkout.
- **Delivery:** Checkout hands the record over when it records the payment and
  again on every later check of that paid checkout (status checks and payment
  wakes), so a failed hand-off is retried and never changes the shopper's
  outcome. Orders paid before this handoff, and any missed one, come over when
  the Orders page opens with no copies and from its Bring in missing orders
  button, which asks Checkout for every paid order (`listPaidOrders`).
- **Under a split:** Checkout posts the same record; Orders' receiver applies
  the same repeat rule. Bring in missing orders becomes a request Checkout
  answers by re-posting.

## 3. Orders to Inventory and Ship: pack and ship this

Orders asks Inventory to pack an order's held stock, and later asks Ship for a
label.

- **Pack** (in place today, `src/features/orders/pack.ts`): Orders builds
  Inventory's `stock.pack` (one ticket) or `stock.pack_all` (every ticket)
  command from the ticket ids on its paid-order copy, with a command id that
  is a digest of the command so a retry replays Inventory's stored answer. No
  order number is sent. Only Inventory's confirmation of that exact command
  counts as packed; Orders records nothing itself.
- **Ship** (not built): a label request carries the order id, the frozen lines
  and the delivery address from the paid-order copy. Ship
  is its own plugin and service, so this message is the same in every
  packaging.
- **Under a split:** unchanged. Inventory and Ship are already outside
  Commerce, so this handoff is HTTP to a hosted service in every direction.
