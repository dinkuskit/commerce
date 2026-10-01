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
EmDash API peer: `1.0.1`.

## Routes

Both the native plugin and the Registry/sandbox descriptor mount:

| Route name | Method | Public | URL |
| --- | --- | --- | --- |
| `checkout/guest/prepare` | `POST` | yes | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare` |
| `checkout/guest/start` | `POST` | yes | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/start` |
| `checkout/guest/status` | `POST` | yes | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/status` |

Public routes skip host session auth and CSRF. They declare incoming headers
`origin`, `sec-fetch-site`, and `x-commerce-guest-capability`. EmDash 0.41
sandbox serialization exposes only those declared headers (max 32, no
`cookie`/`authorization`/`x-emdash-request`). Successful and error responses
use `Cache-Control: private, no-store` unless the host later adds a public GET
cache policy, which these POST routes do not.

Host storage collections:

- Native: `checkoutCarts`, `checkoutGuestCapabilities`
- Sandbox: `checkout_carts`, `checkout_guest_capabilities`

`createCheckoutStore` uses host `getVersioned` / `compareAndSet`. There is no
second order writer.

## Same-origin write admission

Public guest writes are admitted only when:

1. A trusted canonical HTTP(S) site origin is present from host constructor
   `siteUrl` and/or runtime `ctx.site.url` (no `tenantId` on `ctx.site`).
2. The actual `request.url` origin equals that trusted origin.
3. A supported browser or wrapper header is present:
   - `Origin` equal to the trusted origin, or
   - `Sec-Fetch-Site: same-origin` when `Origin` is absent.

`Sec-Fetch-Site` values other than `same-origin` (`cross-site`, `same-site`,
`none`) fail closed. Missing both `Origin` and `Sec-Fetch-Site: same-origin`
fails closed. There is no blanket allow for missing `Origin`.

Canonical origin comparison normalizes safe `http:`/`https:` URL syntax,
strips path/query/hash, and rejects credentials, empty hosts, and unparseable
or non-HTTP(S) values. Do not treat `Host`, query, or body as tenant
authority.

Trusted same-origin server wrappers (Template Store retaining the capability
before responding) must send `Origin: <canonical site origin>` on the
Commerce request they make. The request URL they use must be that same
origin. Wrappers cannot mint authority with a guessed header flag.

Cross-origin and unsupported requests are rejected as `ORIGIN_DENIED` before
capability writes or provider calls.

Default Registry/sandbox invocation has no constructor `siteUrl`. Missing
runtime `ctx.site.url` is explicit host `UNAVAILABLE`, not a fake fallback.
EmDash 0.41 reads an existing `emdash:site_url` option before it loads the
sandbox worker. A trusted site URL stored there before that cold start is a
normal runtime site source. Writing the option after the worker has already
snapshotted site info does not refresh `ctx.site.url`. The default browser
server starts before its tests, so that sandbox guest check still sees the
missing snapshot and stays fail-closed. It does not prove a configured shop.
Native `createPlugin({ siteUrl })` / `dinkusCommerce({ siteUrl })` /
`createPlugin({ checkout: { siteUrl } })` may fill an empty runtime URL.
A present public, malformed, or conflicting runtime URL cannot be masked.

Kernel `prepareGuestCheckout` / `startGuestCheckout` / `statusGuestCheckout`
still require trusted site scope and, for start/status, a presented
capability when called directly. Direct mint and authorize check every known
host scope source together: constructor `siteUrl`, runtime `ctx.site.url`,
top-level `siteUrl`, and `checkout.siteUrl`, including the copy retained on
the runtime and the copy retained on the host. A present empty or malformed
copy is not replaced by another known copy. Conflicting or malformed known
sources fail closed before a capability write and before an existing secret
is authorized. HTTP same-origin is an additional route guard on both native
and Registry surfaces.

## Capability retention

Commerce mints a tenant-scoped guest capability on the trusted server. The
browser cannot choose tenant, site, cart, or attempt authority.

1. `POST checkout/guest/prepare` mints a capability under durable CAS. It
   does not create a cart attempt, reservation, payment session, or contact
   Payments/Inventory.
2. The mint response includes a JSON `capability` object:
   `{ capabilityId, capability, retention: "json-body", header: "x-commerce-guest-capability" }`.
3. Template Store retains `capability` (JSON body, or its own same-origin
   wrapper persisted before the response is returned) and sends it on later
   `start`/`status` requests as header `x-commerce-guest-capability`.
4. `start` and `status` are capability-required. No header or an invalid
   header never mints and never contacts Payments or stock.
5. Guessed cart, order, or attempt IDs do not authorize. The header is the
   only guest authority.

A lost prepare response may leave an unused capability record. It does not
create attempts, sessions, or holds. A lost first `start` response after a
pre-retained capability retries or restarts the same frozen attempt and
provider operation.

One capability identifies one cart. After that cart is paid, repeated `start`
calls remain idempotent for the original purchase. A later purchase needs a
fresh `prepare` capability; keep the prior capability separately if the UI
continues to show that purchase's receipt. Never replace the capability to
retry an unresolved attempt.

EmDash 0.41 public raw responses strip `Set-Cookie` and reject external
`Location`. Commerce therefore does not set cookies or redirect through the
plugin response. If Template Store wants HTTP-only cookie retention, its own
same-origin server wrapper stores the Commerce-issued capability and replays
the header. Commerce still mints and checks the verifier. Do not put the
capability in querystrings.

Host `ctx.site` has `url` and no `tenantId`. Plugin storage is already
site-scoped. Commerce binds a minted capability to the canonical site
origin. A capability from another site origin is denied. Unmanaged checkout
never creates the Inventory store-identity record.

## Request types

`POST checkout/guest/prepare` body may be empty JSON `{}`. Body fields are
not tenant, cart, or payment authority.

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

`capability` is present on prepare mint. Later start/status calls return
`capabilityId` without re-issuing the secret.

Projection schema `dinkuskit.commerce.guest-checkout-projection/v1`:

| Field | Meaning |
| --- | --- |
| `state` | `pending`, `paid`, `recoverable-failure`, or `released-retry` |
| `attemptId` | Server-issued current attempt, not authority; null before start |
| `lines`, `total` | Frozen Commerce USD minor-unit amounts |
| `redirectUrl` | Hosted-payment handoff URL when a session exists; never proof of paid/unpaid |
| `order` | `{ orderId, receiptId, lines, total }` only after a persisted paid Commerce order |
| `retryAfter` | Released attempt id required to start the next attempt |
| `unavailable` | Guest-safe code/message for genuine unavailable attempt state; never raw provider errors |

`order` never includes `paymentId`, provider secrets, or other shopper data.
Unexpected provider or storage failures return guest-safe `UNAVAILABLE` and
never raw provider, storage, or secret strings. A pre-retained capability
keeps a durable recoverable attempt; terminal failures are not swallowed
into fake paid.

Error codes: `CAPABILITY_DENIED`, `CHECKOUT_FROZEN`, `CHECKOUT_NOT_FOUND`,
`CONTENTION`, `INVALID_CART`, `INVENTORY_UNAVAILABLE`, `ORIGIN_DENIED`,
`PAYMENTS_UNAVAILABLE`, `PRODUCT_UNAVAILABLE`, `RETRY_REQUIRED`,
`UNAVAILABLE`.

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
