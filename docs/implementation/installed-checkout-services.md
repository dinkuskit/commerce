# Installed checkout service assembly

The default Commerce Registry entrypoint constructs invocation-local services
from the runtime-supplied `PluginContext`. It uses owner-scoped settings,
declared storage, trusted site URL and scoped HTTP. Functions stay inside the
package; they do not cross descriptor JSON or invoke another plugin. The
resolver neither replaces the context nor caches services or credentials
across installations. Existing canonical catalog/prices, availability,
coupon aggregates, carts, associations and paid order/receipt writers remain
the owners. No stock or money ledger is added.

## Unconfigured and ungranted behavior

The shipped manifest declares `network:request` with exactly
`allowedHosts: ["payments.dinkuskit.com", "coupons.dinkuskit.com"]` (GrillTrack `commerce-allowed-hosts-payments-dinkuskit-com`, locked by the project owner on 2026-10-09, and `commerce-allowed-hosts-coupons-dinkuskit-com`); no wildcard and no other
host. The coupon host serves only coupon checkouts
([registry-hosted-coupons](registry-hosted-coupons.md)). The behavior below
applies whenever the Payments grant is not active.
Absent or explicitly disabled configuration preserves prepare/capability
minting and makes start return `PAYMENTS_UNAVAILABLE`, without reading a
credential, requesting Payments, creating an attempt/order, or scheduling.
Malformed or conflicting configuration returns `UNAVAILABLE` before credentials.

In-process hosts omit `ctx.http` without a network capability. Workerd exposes
an HTTP proxy even with empty grants; its bridge denies the request before
outbound transport. Therefore HTTP presence cannot establish permission. With
valid configured credentials but missing grants, checkout retains its canonical
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

## Credential provider boundary

`installedCheckoutCredential` is a declared `secret` string setting. EmDash
owns encryption and redaction through its host encryption-key configuration.
It must be provisioned by an approved identity integration; this is not a
request for a merchant to manually enter a permanent token. No real value,
issuer grant, host key or refresh endpoint is supplied by this source slice.

The local token reader requires the configured issuer/audience, nonempty
subject, matching signed-claim site, standard space-delimited
`scope: "payments:checkout"`, and valid integral `iat`/`exp`/optional `nbf`.
Only RS256/ES256 token shapes are admitted; expired, future-issued, older-than-
one-hour or mismatched claims fail before transport. Audience arrays are
supported. This parsing filters inputs; it does **not** verify a signature or
attest an issuer/site grant. The paired Payments service remains the authority
for signature, issuer, audience, scope and site ownership.

One credential snapshot is read per configured invocation and its freshness
is rechecked before every authenticated call. No token enters browser
projections, manifests, ordinary KV, logs or proof. Missing/invalid credentials
fail closed. Acquisition/renewal and unattended operation across expiration
remain external integration prerequisites; no alternate issuer is invented.

## Payments and wake transport

The resolver binds scoped `ctx.http.fetch` to the existing trusted TEST payment
port, preserving binding checks, original immutable requests, explicit pricing
schema, response bounds and unknown-outcome recovery. Historical payment
requests are not repriced or migrated by resolver assembly.

The wake port uses `GET /v1/checkout/wakes?bindingRef=...&limit=100` and
`POST /v1/checkout/wakes/ack`. Both reject redirects and use the shared 128 KiB
streamed-byte response bound. Lists contain at most 100 exact five-field
snapshots; binding/event/generation/time fields are validated. ACK sends the
original complete snapshot and requires a boolean acknowledgment envelope.
The existing canonical reconciler settles durable order/coupon effects before
ACK; unknown or malformed results retain recovery state. No public wake route
or automatic scheduling is added. The existing named cron hook can consume
wakes, but actual host scheduler setup/dispatch is a separate proof gate.

Managed availability and reservation remain unavailable without the configured
Inventory provider. Its binding and managed product state are preserved.
Inventory's current checkout kernel has no Worker reserve/release HTTP boundary;
ordinary admin stock mutation is not a substitute. Unmanaged checkout can be
proved independently. Zero-payable canonical orders use the same owner aggregate without Payments
transport; see [zero-payable orders](checkout-zero-payable-orders.md).
Configuration/credential admission remains required, including without an active grant.

## Runtime fixtures and next gate

`tests/integration/registry-checkout-services.test.mjs` invokes the actual
compiled default backend through the pinned `WorkerdSandboxRunner`, original
bridge context, SDK encrypted settings and SQLite repositories. Its isolated
schema mirrors the relevant SDK tables and manifest uniqueness; CAS uses
real atomic SDK SQL. The fixture gives a clearly synthetic manifest variant
`network:request` plus one public IP host solely to avoid DNS. Its host HTTP
callback intercepts **every** request and verifies an ephemeral synthetic
signed JWT; no network service/provider is contacted. The shipped manifest
is asserted to declare exactly `network:request` with `payments.dinkuskit.com`
and `coupons.dinkuskit.com` and is never replaced by that test variant.

These tests prove local runtime service assembly, canonical free/flat coupon
pricing and paid replay, denied grants, configuration/token failures, managed
unavailability and exact cron wake ACK ordering. They are not official Registry
installation/publication, production scheduler, real identity renewal or Stripe
TEST purchase proof. The existing Template owner consumes immutable package
artifacts and performs its own installed-host proof.

The declaration is now `network:request` with the exact approved HTTPS
Payments host `payments.dinkuskit.com` (GrillTrack
`commerce-allowed-hosts-payments-dinkuskit-com`, locked by the project owner on
2026-10-09). Identity renewal may need its own
explicit issuer host/flow. No wildcard/unrestricted grant, private operational
hostname, deployed configuration or permission activation is provided here.
External checkout is not claimed ready until actual installed Registry and
identity/provider proof exists.
