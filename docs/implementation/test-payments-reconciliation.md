# Trusted TEST Payments and wake reconciliation

Commerce exposes a public, host-assembled TEST Payments adapter from
`@dinkuskit/commerce/features/checkout`:

```ts
const checkout = createTrustedTestPaymentsCheckoutHost({
  paymentsOrigin: "https://payments.example.test",
  commerceOrigin: "https://shop.example.test",
  siteId: "site-example",
  bindingRef: "binding-example",
  providerId: "stripe",
  stripeAccountId: "acct_example",
  credentialResolver: resolveApprovedCredential,
  fetch: approvedPaymentsFetch,
});
const plugin = createPlugin({ checkout });
```

The example is configuration shape only. The resolver is lazy and the fetch
function must be a host-approved scoped transport. The adapter pins the
Payments HTTPS origin, site header, TEST Stripe binding, provider and account.
It rejects caller-supplied auth or endpoint overrides, performs readiness
through `checkout-binding` for creation, and performs historical identity
validation through `existing-binding` for lookup. It sends the original frozen
`PaymentRequest` unchanged and preserves `unknown` on transport or malformed
responses. Commerce still performs canonical outcome, amount, identity, and
1800..1860 / historical exact-1800 validation.

Descriptor `options` are JSON serialized by EmDash 1.2.0. They cannot transport
credential or function resolvers. A dedicated native host module may export
named `createPlugin(serializableOptions)`, resolve the approved functions
lazily, and call Commerce's existing `createPlugin` with this host object.
There is no second Commerce plugin, order writer, or browser credential path.
The packaged sandbox remains fail-closed: `capabilities` and `allowedHosts`
stay empty until an exact independently approved Payments network grant is
provided by the host.

Before external payment work, native and sandbox checkout runtime assembly
claims `checkoutPaymentAssociations` / `checkout_payment_associations` with
`attemptId`, `cartId`, and immutable `bindingRef`. The CAS
claim prevents an attempt from being associated with another cart and survives
storage reopen. Existing checkout carts and attempts remain the source of
truth.

Payments currently supplies wake enqueue, not a drain API. Commerce therefore
exports a trusted server-only `CommercePaymentWakePort`:

```ts
interface CommercePaymentWake {
  eventId: string;
  attemptId: string;
  bindingRef: string;
  deliveryGeneration: number;
  wokeAt: number;
}

interface CommercePaymentWakePort {
  list(): Promise<readonly CommercePaymentWake[]>;
  acknowledge(wake: CommercePaymentWake): Promise<boolean>;
}
```

The owner-provided list/ack implementation must retain the canonical Payments
event ID and a per-event delivery generation. Acknowledgment must compare the
complete `{ eventId, attemptId, bindingRef, deliveryGeneration }` identity so
an old acknowledgment cannot remove a newer event. Commerce removes no queue
state itself.
`reconcileGuestPaymentWakes(runtime, wakes)` is the supported host-only
entrypoint: it uses bound plugin storage and the canonical execution writer,
requires a trusted canonical site/payment host and durable association, checks
the stored attempt's original binding, and acknowledges only after a durable
paid order or confirmed terminal released state. Missing, mismatched,
malformed, unknown, unavailable, storage-error, or pre-ack crash cases remain
retryable. There is no unauthenticated wake route and no reuse of the guest
capability as service authentication. A Payments owner drain/list/ack port and
a host scheduler are still required; this repository does not invent that
HTTP/RPC or daemon.

Native hosts should expose a dedicated named host-module entrypoint
`createPlugin(serializableOptions)`. The existing `dinkusCommerce` descriptor
keeps its same identity and admin metadata, replaces only `entrypoint` with
that host module, and puts explicit serializable NONSECRET Payments options in
`descriptor.options` alongside the existing local-development flags:

```ts
const descriptor = {
  id: "dinkus-commerce",
  version: "0.0.0",
  format: "native",
  entrypoint: "@example/store-commerce-host",
  options: {
    paymentsOrigin: "https://payments.example.test",
    commerceOrigin: "https://shop.example.test",
    siteId: "site-example",
    bindingRef: "binding-example",
    providerId: "stripe",
    stripeAccountId: "acct_example",
    enableLocalStockManagement: true,
    siteUrl: "http://127.0.0.1:4321",
  },
  adminEntry: "@dinkuskit/commerce/admin",
  adminPages: [
    { path: "/products", label: "Products", icon: "storefront" },
    { path: "/store", label: "Store", icon: "storefront" },
  ],
};
```

The host module owns `createPlugin(serializableOptions)`, imports Commerce's
`createPlugin` and `reconcileGuestPaymentWakes`, and preserves
`enableLocalStockManagement` and `siteUrl` when it composes the Commerce
plugin. It resolves `credentialResolver` and `fetch` only through lazy,
approved host-owned imports; those functions and credentials never enter
descriptor options. The example names `resolveApprovedCredential` and
`approvedPaymentsFetch` only as owner-supplied imports—they are not magical
globals or evidence that a service, grant, scheduler, or provider is loaded.
The supported scheduler seam is the bound plugin-storage host; drain, ack,
grant, scheduler, and provider implementation remain `NOT_IMPLEMENTED` /
`NOT_ATTESTED` here.

Minimal native entrypoint shape:

```ts
import { createPlugin as createCommercePlugin } from "@dinkuskit/commerce";
import { createTrustedTestPaymentsCheckoutHost } from "@dinkuskit/commerce/features/checkout";
import { resolveApprovedCredential } from "./owner-approved-credential.js";
import { approvedPaymentsFetch } from "./owner-approved-payments-fetch.js";

export function createPlugin(options: {
  paymentsOrigin: string;
  commerceOrigin: string;
  siteId: string;
  bindingRef: string;
  providerId: "stripe";
  stripeAccountId: string;
  enableLocalStockManagement?: boolean;
  siteUrl?: string;
}) {
  const checkout = createTrustedTestPaymentsCheckoutHost({
    ...options,
    credentialResolver: resolveApprovedCredential,
    fetch: approvedPaymentsFetch,
  });
  return createCommercePlugin({
    enableLocalStockManagement: options.enableLocalStockManagement,
    siteUrl: options.siteUrl,
    checkout,
  });
}
```

The descriptor is one `dinkusCommerce` descriptor with the same identity and
admin metadata, with only its entrypoint replaced by this named host module.
Its `options` explicitly carry the serializable NONSECRET Payments values shown
above plus `enableLocalStockManagement` / `siteUrl`; functions and credentials
remain lazy host-module imports. The actual scheduler/wake API and host grants
are unavailable in this repository.

This slice proves synthetic transport and native EmDash sqlite/plugin-storage
reconciliation behavior only. It does not claim a Payments grant, merchant
readiness, Stripe TEST purchase, browser proof-host composition, packaged
Registry install, deployment, or production configuration.
