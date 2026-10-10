# Delivery address for physical orders (2026-10-10)

Decision: `commerce-delivery-address-001` (locked on the owner's approval,
2026-10-10 03:56 UTC), commerce#33. Contract:
`docs/implementation/checkout-contact-v1.md` and
`docs/contracts/commerce-handoffs.md`.

## Registry backend size

| | `dist/sandbox/plugin.mjs` bytes | headroom to 131,072 |
| --- | --- | --- |
| main f550d41 (with #84) | 117,720 | 13,352 |
| with delivery address | 119,402 | 11,670 |

## Checks run on this change

`bin/verify-commerce full` with Node 22.23.2 passed on main f550d41 plus this change: typecheck clean, unit
484 of 484, `audit:repo` clean, integration 46 of 46, sandbox 10 of 10,
native local stock 1 of 1, Orders 1 of 1.

Address-specific tests:

- `tests/features/checkout/delivery-address.test.mjs`: address input trimmed,
  bounded, unknown fields refused; physical baskets need an address in a
  shipping country (none set refuses); digital-only baskets keep none;
  unmarked and mixed baskets refused before any attempt or payment; the
  address reaches the paid-order record and the Orders detail ("Ship to").
- `tests/features/orders/page.test.mjs`: Orders refuses a paid order whose
  contact snapshot has no contact, no email, or a delivery address missing a
  required field; a copy kept before that check still shows "No address".
- `tests/integration/registry-checkout-services.test.mjs`: an admin-created
  (unmarked) product checks out on the installed runtime with a US address.
- `tests/sandbox/variant-checkout.spec.mjs` (native storefront): a physical
  variant is refused with no address and with a country the store does not
  ship to, then starts with a US address frozen in the contact snapshot.

Live shops: a storefront checkout form must send `contact.delivery` before
physical orders can be taken; the sandbox test storefront in this repo does.
