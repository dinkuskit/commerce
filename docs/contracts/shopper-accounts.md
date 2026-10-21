# Shopper Accounts and Store Role Boundary

The confirmed architectural decision `shopper-accounts-v1-20261020` establishes
how shopper accounts (`customer`) and store staff roles (`shop_manager` / owner)
map onto DinkusKit Commerce and EmDash CMS without mixing public buyers into
EmDash's editorial user table. This is a locked product contract and source
boundary, not an implemented route or storage change in this decision slice.

## Confirmed boundary

1. **Persona and identity separation**: Shopper accounts (`customer`) live in
   `@dinkuskit/commerce` plugin storage, never in EmDash CMS `users`
   (`@emdash-cms/auth`). EmDash `/_emdash/admin` and `/_emdash/api/auth/*`
   remain strictly staff/editorial surfaces behind the store's admin access
   boundary.
2. **How WooCommerce-style roles translate**:
   - **Shopper (`customer`)**: A store-local Commerce customer record keyed by
     case-folded verified email, with zero EmDash CMS role or `/_emdash/admin`
     access.
   - **Store clerk / shop manager (`shop_manager`)**: Maps to EmDash's existing
     `Role.EDITOR (40)` tier (`permission: "content:edit_any"` on the Commerce
     Block Kit `admin` route) for day-to-day catalog and order operations.
   - **Store owner / administrator**: Maps to EmDash's `Role.ADMIN (50)` tier
     (`permission: "plugins:manage"`) for plugin settings (`installedCheckout`,
     `storeKey`) and the `orders` API token surface.
   - EmDash `1.2.0` and `1.3.1` keep a closed 5-tier numeric `Role` enum
     (`SUBSCRIBER: 10`, `CONTRIBUTOR: 20`, `AUTHOR: 30`, `EDITOR: 40`,
     `ADMIN: 50`) and read-only `users:read` plugin capability; plugins do not
     register custom CMS roles or write to EmDash `users`.
3. **Passwordless 6-digit email code sign-in**:
   - Commerce declares `"email:send"` in `emdash-plugin.jsonc` `capabilities`
     and sends a short-lived 6-digit one-time verification code via
     `ctx.email.send(...)` when a shopper starts sign-in on the storefront.
   - Entering the 6-digit code on the storefront verifies email ownership in
     place (no cross-tab magic-link redirect required) and mints an opaque
     customer session capability (`<sessionId>.<secret>`, SHA-256 hashed at
     rest and bound to the trusted site origin, matching the
     `x-commerce-guest-capability` security model).
   - Because the EmDash workerd sandbox strips `Cookie`, `Set-Cookie`, and
     `Authorization` headers on plugin routes, public Commerce account routes
     accept the session via the declared header
     `x-commerce-customer-session` (`retention: "json-body"`).
4. **Automatic order history linking by verified email**:
   - Past and future orders in Commerce `orders` whose frozen checkout contact
     email (`paidOrder.contactSnapshot.contact.email`) matches the shopper's
     verified email (compared case-insensitively via ASCII lowercase) link
     automatically to the shopper's account view without mutating `paidOrder`
     snapshots.
   - The shopper order view projects order number, `paidAt`, fulfillment status
     (`Processing` vs. `Completed`), carrier and tracking number when present,
     line items, pricing summary, and effective delivery address
     (`record.delivery ?? record.paidOrder.contactSnapshot?.contact.delivery`).
5. **Single default saved shipping address and phone**:
   - Each customer record in Commerce storage holds at most one default
     `CheckoutDeliveryAddress` (validated by `normalizeCheckoutDelivery`) and
     an optional normalized phone number (`normalizeCheckoutContactInput`).
   - If the customer record has no saved delivery address yet, it auto-seeds
     from their most recent order's effective delivery address upon account
     read/sign-in and can be edited by the shopper in their Account view or
     used to prefill checkout.

## Platform reference check (`emdash-commerce`)

Official platform documentation inspected October 20, 2026 informed this
boundary:

- **Shopify Customer Account API vs. Admin**: Separates buyer identity
  (passwordless email OTP / passkey customer accounts) from merchant staff
  accounts; guest orders matching a customer's verified email associate with the
  customer record without granting Shopify Admin permissions.
- **BigCommerce Customers API & commercetools Customers**: Maintain dedicated
  storefront customer records and customer session tokens distinct from Control
  Panel / Merchant Center operator accounts.
- **WooCommerce / WordPress**: Stores `customer` and `shop_manager` inside the
  shared `wp_users` table, requiring explicit `/wp-admin` blocks for shoppers.
  Because EmDash's `/_emdash*` routes and `users` table are editorial/admin
  infrastructure (and read-only to sandboxed plugins), DinkusKit follows the
  decoupled Shopify / BigCommerce / commercetools customer boundary instead.

## Next bounded implementation slice

Implementation remains separate from this decision lock and will proceed in
bounded slices across `@dinkuskit/commerce` (storage collections, `email:send`
capability, passwordless OTP start/verify/sign-out routes, customer session
capability verification, and authenticated order/profile routes within the
131,072-byte `dist/backend.js` ceiling) and `@dinkuskit/template-store`
(storefront Account UI and checkout prefill).
