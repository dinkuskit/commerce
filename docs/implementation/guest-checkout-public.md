# Guest checkout public contract for Template Store

Commerce issue 32 public handoff. Template Store issue 20 consumes this
artifact and these routes. Template Store renders only these public outputs.
It does not become a pricing, payment, or order engine.

Package identity: `@dinkuskit/commerce@0.0.0` (private, unpublished).
Public entry: `@dinkuskit/commerce/features/checkout`.
Native plugin: `createPlugin()` / `dinkusCommerce()`.
Registry/sandbox entry: `@dinkuskit/commerce/sandbox` built from
`emdash-plugin.jsonc` + `src/plugin.ts`.
Runtime slug: `dinkus-commerce`.
EmDash API peer: `0.41.0`.

## Routes

Both the native plugin and the Registry/sandbox descriptor mount:

| Route name | Method | Public | URL |
| --- | --- | --- | --- |
| `checkout/guest/start` | `POST` | yes | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/start` |
| `checkout/guest/status` | `POST` | yes | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/status` |

Public routes skip host session auth and CSRF. They declare incoming header
`x-commerce-guest-capability`. Successful and error responses use
`Cache-Control: private, no-store` unless the host later adds a public GET
cache policy, which these POST routes do not.

Host storage collections:

- Native: `checkoutCarts`, `checkoutGuestCapabilities`
- Sandbox: `checkout_carts`, `checkout_guest_capabilities`

`createCheckoutStore` uses host `getVersioned` / `compareAndSet`. There is no
second order writer.

## Capability retention

Commerce mints a tenant-scoped guest capability on the trusted server. The
browser cannot choose tenant, site, cart, or attempt authority.

1. `start` without the capability header mints a new capability and cart.
2. The mint response includes a JSON `capability` object:
   `{ capabilityId, capability, retention: "json-body", header: "x-commerce-guest-capability" }`.
3. Template Store retains `capability` and sends it on later `start`/`status`
   requests as header `x-commerce-guest-capability`.
4. Guessed cart, order, or attempt IDs do not authorize. The header is the
   only guest authority.

EmDash 0.41 public raw responses strip `Set-Cookie` and reject external
`Location`. Commerce therefore does not set cookies or redirect through the
plugin response. If Template Store wants HTTP-only cookie retention, its own
same-origin server wrapper stores the Commerce-issued capability and replays
the header. Commerce still mints and checks the verifier. Do not put the
capability in querystrings.

Host `ctx.site` has `url` and no `tenantId`. Plugin storage is already
site-scoped. Commerce also binds a minted capability to the host site URL
when that URL is present. A capability from another site URL is denied.
Unmanaged checkout never creates the Inventory store-identity record.

## Request types

`POST checkout/guest/start` body:

```json
{ "lines": [{ "catalogItemId": "item-id", "quantity": 1 }] }
```

Only `catalogItemId` (non-empty string) and a positive safe integer
`quantity` are accepted. Extra fields, including `price`, `total`,
`paymentState`, `provider`, `binding`, `redirect`, `cartId`, `paid`, and
`attemptId`, are rejected.

`POST checkout/guest/status` body may be empty or include a wake hint
`{ "wake": true, "attemptId": "<server-issued>" }`. `attemptId` is a locator
for an attempt already on the authorized cart. `paid`, webhook bodies,
success URLs, timers, and provider fields are not authority.

## Response types

Portable JSON result (also wrapped by the host as `{ success, data }` on
JSON routes):

```ts
type GuestCheckoutResult =
  | {
      ok: true;
      capabilityId: string;
      capability?: {
        capabilityId: string;
        capability: string;
        retention: "json-body";
        header: "x-commerce-guest-capability";
      };
      checkout: GuestCheckoutProjection;
    }
  | { ok: false; error: { code: GuestCheckoutErrorCode; message: string } };
```

`capability` is present only on first mint. Later calls return `capabilityId`
without re-issuing the secret.

Projection schema `dinkuskit.commerce.guest-checkout-projection/v1`:

| Field | Meaning |
| --- | --- |
| `state` | `pending`, `paid`, `recoverable-failure`, or `released-retry` |
| `attemptId` | Server-issued current attempt, not authority |
| `lines`, `total` | Frozen Commerce USD minor-unit amounts |
| `redirectUrl` | Hosted-payment handoff URL when a session exists; never proof of paid/unpaid |
| `order` | `{ orderId, receiptId, lines, total }` only after a persisted paid Commerce order |
| `retryAfter` | Released attempt id required to start the next attempt |
| `unavailable` | Guest-safe code/message, never raw provider errors |

`order` never includes `paymentId`, provider secrets, or other shopper data.

Error codes: `CAPABILITY_DENIED`, `CHECKOUT_FROZEN`, `CHECKOUT_NOT_FOUND`,
`CONTENTION`, `INVALID_CART`, `INVENTORY_UNAVAILABLE`, `PAYMENTS_UNAVAILABLE`,
`PRODUCT_UNAVAILABLE`, `RETRY_REQUIRED`, `UNAVAILABLE`.

Native route dispatch throws those codes as HTTP 400/403/404/409/503
`PluginRouteError` values. Sandbox/workerd handlers return the same
`{ ok: false, error }` object because the sandbox runner does not rehydrate
native `PluginRouteError`. Template Store should honor `error.code` /
`data.error.code` on both surfaces.

## Payments and Inventory

Default `createPlugin()` and the Registry sandbox plugin have no production
Payments adapter. Start then returns `PAYMENTS_UNAVAILABLE`. There is no
shipped fake provider.

Hosts that have a Payments adapter inject it only through
`createPlugin({ checkout: { paymentBindingRef, resolvePayments, resolveInventory } })`.
That option uses the existing public `CheckoutPaymentPort` /
`CheckoutInventoryPort` shapes. Registry/sandbox cannot invoke another
plugin as a Payments provider; that is a host gate, not a silent fallback.

Unmanaged baskets never resolve Inventory and do not require Inventory
configuration. Managed baskets stay fail-closed without an authoritative
provider. Accepted window is the provider-reported inclusive 1800..1860-second
hosted card session (`paymentWindow:{minSeconds:1800;maxSeconds:1860}`),
card/USD, positive totals. Frozen `paymentWindowSeconds: 1800` originals stay
exact. See [checkout-payment-window.md](checkout-payment-window.md).

## Fixture versus production

Synthetic Payments ports exist only in trusted test injection. They prove
transport, capability, and projection. They are not Stripe. Actual Stripe
is separately not run. Real provider `createdAt`/`expiresAt` remain an adapter
obligation. Contact, delivery, shipping, tax, countries, carriers, phone,
and receipt delivery remain unresolved follow-up work (issues 33/34).
