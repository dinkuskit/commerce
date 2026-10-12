# Installed checkout service assembly

The default Commerce Registry entrypoint constructs invocation-local services
from the runtime-supplied `PluginContext`. It uses owner-scoped settings,
declared storage, trusted site URL and scoped HTTP. Functions stay inside the
package; they do not cross descriptor JSON or invoke another plugin. The
resolver neither replaces the context nor caches services or credentials
across installations or invocations. Existing canonical catalog/prices, availability,
coupon aggregates, carts, associations and paid order/receipt writers remain
the owners. No stock or money ledger is added.

## Unconfigured and ungranted behavior

The shipped manifest declares `network:request` with exactly
`allowedHosts: ["payments.dinkuskit.com", "coupons.dinkuskit.com", "ship.dinkuskit.com", "dinkuskit.com"]` (GrillTrack `commerce-allowed-hosts-payments-dinkuskit-com`, locked by the project owner on 2026-10-09, `commerce-allowed-hosts-coupons-dinkuskit-com`, `commerce-allowed-hosts-ship-dinkuskit-com` and `commerce-allowed-hosts-dinkuskit-com`); no wildcard and no other
host. The coupon host serves only coupon checkouts
([registry-hosted-coupons](registry-hosted-coupons.md); unhooked in v1), the Ship host only
Orders ([registry-ship-sync](registry-ship-sync.md)), and `dinkuskit.com` only
the store-key trade ([store key and passes](#store-key-and-passes)). The behavior below
applies whenever the Payments grant is not active.
Absent or explicitly disabled configuration preserves prepare/capability
minting and makes start return `PAYMENTS_UNAVAILABLE`, without reading the
store key, trading it, requesting Payments, creating an attempt/order, or
scheduling. Malformed or conflicting configuration returns `UNAVAILABLE` before
the store key is read.

In-process hosts omit `ctx.http` without a network capability. Workerd exposes
an HTTP proxy even with empty grants; its bridge denies the request before
outbound transport. Therefore HTTP presence cannot establish permission. With
a valid configuration and store key but missing grants, checkout retains its canonical
unconfirmed attempt without a paid order, and wakes cannot acknowledge it.
The resolver does not probe grants, bypass host/SSRF policy, or infer provider
not-created from transport failure. Without an active grant the artifact
cannot complete an external checkout. Declaring the host does not activate it
on any site; activation stays a host and owner step.

## Versioned owner configuration

`installedCheckout` is a declared string setting containing JSON. It is read
with the SDK's `getVersioned`; the resulting configuration snapshot and opaque
revision belong to this invocation. Every enabled field below is required;
unknown fields, unsupported schema and invalid shipping fail closed.

```json
{
  "schema": "dinkuskit.commerce.registry-checkout/v1",
  "enabled": true,
  "commerceOrigin": "https://shop.example.test",
  "siteId": "owner-supplied-site-id",
  "paymentsOrigin": "https://payments.example.test",
  "bindingRef": "owner-supplied-binding",
  "providerId": "stripe",
  "stripeAccountId": "owner-supplied-account",
  "pricingSchema": "dinkuskit.commerce.checkout-pricing/v1",
  "issuer": "https://identity.example.test",
  "audience": "owner-supplied-audience",
  "shipping": {
    "configurationId": "owner-supplied-shipping",
    "revision": 1,
    "mode": "free"
  }
}
```

Disabled configuration is exactly `{ "schema":
"dinkuskit.commerce.registry-checkout/v1", "enabled": false }`.
The enabled `commerceOrigin` must match the runtime's canonical site origin;
copying another site's configuration does not rebind the installation.
Payments uses a bare HTTPS origin, exact site/binding/provider/account and
explicit paired `pricing/v1` support. Shipping is free or flat with a positive
configuration revision; flat requires canonical nonnegative USD `amount`,
and a supplied free amount must be zero. The shipping reader supplies this
trusted snapshot to the existing evaluator. Browser amounts are never read.

The configuration is scoped by the runtime plugin ID. Native and Registry
IDs have different settings namespaces; no automatic migration or foreign
coupon collection is accepted.

## Store key and passes

`storeKey` is Commerce's only secret setting: one key per store, pasted from
the Set up Commerce box on DinkusKit.com (GrillTrack `commerce-store-key-001`).
EmDash owns its encryption and redaction. Commerce ignores spaces or line
breaks pasted around the key, treats it as opaque text of at most 512
characters and sends it nowhere but the trade below.

Each Payments, Coupons or Ship call trades the key for a short pass scoped to
that one service: `POST https://dinkuskit.com/api/store-passes`, an address
fixed in Commerce that no setting changes, with `Authorization: Bearer <store
key>`, no cookies, `redirect: "error"` and exactly `{ "site_id", "scope",
"audience" }`. Payments, Coupons and Ship are allowed hosts too, so pasted
settings that name one of them as the `issuer` still send the key only to
DinkusKit.com; its passes then fail admission and no call is made.
The pairs are `payments:checkout` with the configured `audience`,
`coupons:checkout` with `coupons.audience`, and `ship:orders` with
`ship.audience`; while coupons are unhooked for v1
([registry-hosted-coupons](registry-hosted-coupons.md)), the Registry build
never trades `coupons:checkout`. An invocation trades only when it first needs a service, at
most once per scope; prepare never trades. The answer is read through the same
128 KiB bounded JSON reader as Payments' answers, and only `access_token` is
used.

Any answer other than 200, and any pass that fails admission, means no pass,
so that call is not made: start returns `checkout.state: "recoverable-failure"`
without reaching Payments, a coupon is refused as unavailable to try later, and
Orders leaves Ship for its next sync. Commerce does not retry in a loop and does
not show DinkusKit.com's error codes (`invalid_store_key`, `site_mismatch`,
`service_not_enabled`, `service_cut_off`, `store_suspended`, `rate_limited`,
`merchant_unavailable`, `signing_unavailable`); they are for its logs and the
owner. A configured checkout without a store key is `UNAVAILABLE` before any
trade.

Stores that saved passes in `installedCheckoutCredential`,
`installedCheckoutCouponsCredential` or `installedShipCredential` before the
store key keep those saved values, but Commerce no longer reads or sends them:
checkout stays `UNAVAILABLE`, and Orders and the background check call nothing,
until the owner pastes a store key.

Each store turns on any of Payments, Coupons and Ship on DinkusKit.com.
Payments counts as on while its Connect grant is active, Coupons and Ship are
switches there, and DinkusKit.com mints passes only for services that are on.
Commerce calls only the services its pasted checkout settings name, so a switch
change comes with new settings to paste. Replace key on DinkusKit.com stops the
old key at once: its next trade answers 401, and pasting the new key is the
only step in Commerce.

The local token reader requires the configured issuer, the audience asked for,
a nonempty subject, the matching signed-claim site, the scope asked for in the
standard space-delimited `scope`, and valid integral `iat`/`exp`/optional `nbf`.
Only RS256/ES256 token shapes are admitted; expired, future-issued, older-than-
one-hour or mismatched claims fail before transport. Audience arrays are
supported. This parsing filters inputs; it does **not** verify a signature or
attest an issuer/site grant. Each paired service remains the authority
for signature, issuer, audience, scope and site ownership.

Each traded pass is rechecked before every authenticated call. No key or pass
enters browser projections, manifests, ordinary KV, logs or proof.

## Payments and wake transport

The resolver binds scoped `ctx.http.fetch` to the existing trusted payment
port, preserving binding checks, original immutable requests, explicit pricing
schema, response bounds and unknown-outcome recovery. The configuration's
optional `mode` (`test` when absent, or `live`) must match the mode Payments
reports for the binding before every session or lookup. Each checkout
attempt keeps the mode it started in (absent on older attempts, meaning test)
and is looked up only while the configuration is in that mode, so a test
payment never becomes a live order or the reverse; each paid order, including
a zero-payable one, records the attempt's mode (GrillTrack
`commerce-payment-mode-001`). Historical payment
requests are not repriced or migrated by resolver assembly.

The wake port uses `GET /v1/checkout/wakes?bindingRef=...&limit=100` and
`POST /v1/checkout/wakes/ack`. Both reject redirects and use the shared 128 KiB
streamed-byte response bound. Lists contain at most 100 exact five-field
snapshots; binding/event/generation/time fields are validated. ACK sends the
original complete snapshot and requires a boolean acknowledgment envelope.
The existing canonical reconciler settles durable order/coupon effects before
ACK; unknown or malformed results retain recovery state. No public wake route
is added. The named cron hook consumes wakes every 5 minutes once EmDash has
switched the plugin on and the site's scheduler runs
([background check](installed-checkout-context.md#background-check),
GrillTrack `commerce-background-check-001`).

Managed availability and reservation remain unavailable without the configured
Inventory provider. Its binding and managed product state are preserved.
Inventory's current checkout kernel has no Worker reserve/release HTTP boundary;
ordinary admin stock mutation is not a substitute. Unmanaged checkout can be
proved independently. Zero-payable canonical orders use the same owner aggregate without Payments
transport; see [zero-payable orders](checkout-zero-payable-orders.md).
Configuration and store-key admission remain required, including without an active grant.

## Checkout readiness

Call through the same installed EmDash dispatcher and Registry plugin identity used for `catalog/public`. A native alias or separately constructed context is not an installation attestation. This is configuration readiness, not approval of a particular cart or a checkout capability.

The Registry-only public endpoint `checkout/guest/readiness` (`GET`) provides a thin, non-secret check of checkout readiness. It returns a versioned closed response:

- Supported: `{ "schema": "dinkuskit.commerce.checkout-readiness/v1", "status": "supported", "mode": "test" }`
- Unavailable: `{ "schema": "dinkuskit.commerce.checkout-readiness/v1", "status": "unavailable" }`

### Semantics and boundaries

- **Actual binding check**: Readiness verifies actual existing owner-controlled Payments binding (`ready === true`, exact provider/merchant/site/origin/mode) via scoped service assembly.
- **Read-time service effect**: Trading the store key for a `payments:checkout` pass during readiness inspection is strictly a read-time service effect. It performs no mutation of orders, capabilities, carts, or settings.
- **Advisory status**: Readiness is strictly advisory. `prepare` only issues a capability and does not attest Payments readiness. `start` validates the binding before session creation; unresolved `status` validates it before authoritative lookup. Replaying a previously settled order needs no new provider call.
- **Supported mode**: Only `test` mode is supported for positive readiness in this version; non-test or mismatched modes fail closed to `unavailable`.
- **Closed guest-safe response**: No secrets, tokens, store keys, account identifiers, or binding references are exposed in the readiness response. Any configuration error, storage mismatch, refused store pass, or network failure safely results in `{ "schema": "dinkuskit.commerce.checkout-readiness/v1", "status": "unavailable" }`.
- **No browser flags or preparation inference**: Readiness does not infer status from schema existence, prepare calls, or browser headers (e.g. `Sec-Fetch-Site`). If an `Origin` header is supplied, it must match the canonical site origin.

## Runtime fixtures and next gate

`tests/integration/registry-checkout-services.test.mjs` invokes the actual
compiled default backend through the pinned `WorkerdSandboxRunner`, original
bridge context, SDK encrypted settings and SQLite repositories. Its isolated
schema mirrors the relevant SDK tables and manifest uniqueness; CAS uses
real atomic SDK SQL. The fixture gives a clearly synthetic manifest variant
`network:request` plus public IP hosts solely to avoid DNS. Its host HTTP
callback intercepts **every** request: a stand-in for DinkusKit.com's trade
checks the synthetic store key and hands out ephemeral synthetic signed JWTs,
and the service stand-ins verify them; no network service/provider is
contacted. The shipped manifest is asserted to declare exactly
`network:request` with `payments.dinkuskit.com`, `coupons.dinkuskit.com`,
`ship.dinkuskit.com` and `dinkuskit.com` and is never replaced by that test
variant.

These tests prove local runtime service assembly, canonical free/flat shipping
pricing and paid replay, coupon codes refused while coupons are unhooked,
denied grants, configuration/token failures, refused
and replaced store keys, one trade per service per invocation, managed
unavailability and exact cron wake ACK ordering. They are not official Registry
installation/publication, production scheduler, a real DinkusKit.com trade or
Stripe TEST purchase proof. The existing Template owner consumes immutable package
artifacts and performs its own installed-host proof.

The declaration is `network:request` with the four exact approved HTTPS hosts
above; `dinkuskit.com` serves only the store-key trade (GrillTrack
`commerce-allowed-hosts-dinkuskit-com`). No wildcard/unrestricted grant, private operational
hostname, deployed configuration or permission activation is provided here.
External checkout is not claimed ready until actual installed Registry and
identity/provider proof exists.
