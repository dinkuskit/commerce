# Billing address on orders

Owner decision accepted 2026-10-29. Base: Commerce d61d2d2; Payments d9cdee6.
It replaces the "no billing collection" wording in `commerce-delivery-address-001`
and in the scope note of `us-physical-delivery-regions-20261021`.

Every checkout records a billing address beside the delivery address, and the
owner sees both on the order. Before this, checkout collected no billing
address (`commerce-delivery-address-001`), Orders showed only the delivery
address and no customer email or phone, and Payments returned no billing
details from Stripe or Authorize.net.

## Choice

1. The store's own checkout asks for billing: name, line 1, optional line 2,
   city, optional state or region, postal code, and a two-letter country. It
   uses the delivery address's shape and field checks.
2. With a delivery address, "Billing address same as delivery address" is
   ticked by default and the storefront sends a full copy. Unticking shows the
   billing fields. A digital-only basket shows the billing fields directly.
3. Billing may be in any country. Only delivery is checked against the store's
   shipping destinations (keeps `initial-foreign-billing-us-delivery-001`).
4. Commerce refuses a checkout without a billing address. There is no
   fallback to the delivery address: no store runs an older storefront, so the
   template store's form ships with this change.
5. Billing is frozen into the checkout contact snapshot at checkout start and
   rides on the paid order. It is a full copy, never a reference to the
   delivery address. It is not editable after payment in v1.
6. The Orders detail shows Email, Phone, Ship to and Bill to. Bill to reads
   "Same as delivery address" when it equals the current delivery address and
   "Not recorded" on orders paid before this change.
7. The agents' orders API returns `billTo` in the same shape as `shipTo`, and
   `billToMatchesShipTo`. Agents never resolve a "same as" reference.
8. Payments, Stripe and Authorize.net are unchanged. The card form still asks
   what the card network checks.

## Focused evidence (checked 2026-10-29)

| Source | Relevant pattern | Application and limit |
| --- | --- | --- |
| Shopify Admin GraphQL `Order` (2026-10 schema, REA corpus) | `billingAddress` plus `billingAddressMatchesShippingAddress: Boolean!` on the order | Adopt for agents: a full billing copy and a match flag. |
| [Shopify `OrderInput`](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/OrderInput) | `orderUpdate` can overwrite email and shipping address; it has no billing field | Adopt: billing frozen after payment; delivery correction already exists. |
| [WooCommerce order screen](https://woocommerce.com/document/managing-orders/view-edit-or-add-an-order/) | Billing and Shipping columns; billing fields are editable by the owner | Defer owner edits of billing; revisit with a real need. |
| Shop MCP and UCP checkout schemas (REA corpus, 2026-07-28) | `billing_address` sits on the card payment instrument and is required for cards | Adapt later: an agent checkout adapter maps it to `contact.billing`. No rename now. |
| [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create), [Authorize.net Accept Hosted](https://developer.authorize.net/api/reference/features/accept-hosted.html) | Both hosted pages can collect a billing address and return it | Reject for v1: shoppers would type the address twice; Stripe cannot pre-fill it. |
