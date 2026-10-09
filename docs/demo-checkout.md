# Demo checkout (Stripe TEST mode)

This is the Commerce-side handoff for `demo.dinkuskit.com`. It enables the
existing guest checkout routes only when the host supplies a complete,
server-owned Payments configuration. It does not contain a Stripe key,
webhook secret, merchant data, or a real binding reference.

## Host configuration

Store `installedCheckout` as the versioned JSON value below. Replace only the
angle-bracket placeholders with values issued for this site:

```json
{
  "schema": "dinkuskit.commerce.registry-checkout/v1",
  "enabled": true,
  "commerceOrigin": "https://demo.dinkuskit.com",
  "siteId": "<Payments site id>",
  "paymentsOrigin": "https://<Payments host>",
  "bindingRef": "<server-owned Payments binding reference>",
  "providerId": "stripe",
  "mode": "test",
  "stripeAccountId": "acct_<Stripe Connect TEST account>",
  "pricingSchema": "dinkuskit.commerce.checkout-pricing/v1",
  "issuer": "https://<DinkusKit identity issuer>",
  "audience": "<Payments checkout audience>",
  "shipping": {
    "configurationId": "demo-free-shipping",
    "revision": 1,
    "mode": "free"
  }
}
```

Predecessor v1 enabled snapshots that omit `mode` remain valid under this
schema. Payments still has to prove the remote binding is TEST before a
session or lookup is created. Stored `mode`, when present, must be `test`.

The host must also provision `installedCheckoutCredential` as an encrypted
secret setting containing a short-lived signed server-to-server token. It must
be issued for the same `siteId`, `issuer`, `audience`, and
`payments:checkout` scope. Commerce reads it only server-side.

Payments, not Commerce or Template Store, owns the Stripe credentials:

- `STRIPE_API_KEY` is a Payments host secret beginning with `sk_test_`.
- `STRIPE_WEBHOOK_SECRET` is a Payments host secret beginning with `whsec_`.
- The connected account and binding must be Stripe TEST mode.

Never put any of those values in `installedCheckout`, browser code, a
Commerce request, a Wrangler variable, or this repository. `stripeAccountId`
is an identity assertion checked against the Payments binding; it is not a
credential. Do not accept provider, mode, binding, account, amount, or
redirect values from the guest request.

The installed Commerce runtime also needs the host's scoped `network:request`
grant for the exact bare `paymentsOrigin`. The shipped Commerce manifest
declares that capability with exactly one allowed host,
`payments.dinkuskit.com`, so `paymentsOrigin` must be
`https://payments.dinkuskit.com`. Activating the grant or deploying it is still
a host approval step, not a repository-side default.

## Guest flow

Template Store calls these same-origin `POST` routes:

```text
/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare
/_emdash/api/plugins/dinkus-commerce/checkout/guest/start
/_emdash/api/plugins/dinkus-commerce/checkout/guest/status
```

1. `prepare` mints a server-owned capability. It performs no payment or
   inventory operation.
2. `start` sends only catalog item IDs and positive quantities, re-reads
   Commerce price and sellability, freezes the amount and binding, creates
   the attempt, and calls Payments `POST /v1/checkout/session`. The response
   redirect is used only after Commerce validates its identity, amount,
   currency, session window, and HTTPS URL.
3. `status` performs Payments `POST /v1/checkout/lookup` for the existing
   attempt and projects the durable Commerce result. `open` and `unknown`
   remain pending; a matching `paid` lookup is required before Commerce
   writes the order. Amount or currency mismatch is rejected.

Missing or invalid configuration returns `PAYMENTS_UNAVAILABLE` (or a safe
unavailable error) and must keep the Template Store checkout button disabled.
The guest cannot select a provider, account, mode, total, or success state.

## Webhook wakes

Payments webhook verification is only a wake signal. Commerce's installed
reconciler reads `GET /v1/checkout/wakes?bindingRef=...`, looks up each
attempt authoritatively, durably settles the Commerce order or release, and
then calls `POST /v1/checkout/wakes/ack`. A signed webhook body, Stripe return
URL, cancel URL, browser query parameter, or elapsed timer never marks an order
paid. Unknown results remain retained for retry.

The host must invoke the installed `commerce-checkout-wakes` cron hook and
provide the Payments wake list/ack endpoints. This repository does not claim a
live Payments grant, deployment, scheduler, merchant readiness, or real Stripe
purchase.

## Template Store remaining work

Template Store still needs to:

- enable the cart checkout button only when Commerce is configured; preserve
  the `PAYMENTS_UNAVAILABLE` disabled state;
- keep the guest cart as the source of line identity and quantity, then pass
  the prepare capability to start;
- redirect only to the validated `checkout.redirectUrl`;
- make `success.astro` call Commerce status and show verification/pending until
  the status projection is `paid`;
- make `cancel.astro` call Commerce status or show a non-paid return state;
  neither page may infer payment from return parameters;
- add browser coverage for cart → hosted Stripe TEST Checkout → return →
  Commerce status, including a pending/unknown case.

Contact, billing, delivery, shipping-rate, tax, receipt-delivery, and guest
retrieval policy remain the bounded follow-up in Commerce issue #33. They do
not block this line-only demo checkout and are not invented here.
