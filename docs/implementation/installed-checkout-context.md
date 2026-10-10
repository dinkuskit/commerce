# Installed Commerce checkout context

This adapter contract is retained alongside the subsequently bundled default
[Registry service resolver](./installed-checkout-services.md). That resolver is
implemented; the installation, host consent, and real-provider boundaries below
remain prerequisites for actual activation.

The compiled `@dinkuskit/commerce/features/checkout` subpath exposes
`createInstalledCheckoutHandlers(resolveServices?, paidOrders?)`,
`createInstalledCheckoutWakeHook(resolveServices?, paidOrders?)`, and
`COMMERCE_CHECKOUT_WAKES_TASK` (`commerce-checkout-wakes`).

Guest methods use the supported sandbox handler shape:
`prepare(routeCtx, pluginCtx)`, `start(routeCtx, pluginCtx)`, and
`status(routeCtx, pluginCtx)`. The original runtime-owned `PluginContext`
remains separate from route input and is the only input to the trusted service
resolver. `reconcileWakes(pluginCtx)` returns either a typed unavailable or
not-configured result, or the canonical per-wake reconciliation results.
`cron(event, pluginCtx)` processes only the exact task name. The default
sandbox entry wires the three POST routes and cron hook, with no Payments
services configured and no automatically scheduled task.

The adapter requires the fixed declared sandbox collection names from
`SANDBOX_GUEST_CHECKOUT_STORAGE`; it accepts no storage-name argument or
native collection aliases. Config-loaded sandbox descriptors use
`dinkus-commerce`. Actual Registry installs use `r_gshdrqaldna3r7sn`, the
EmDash 1.2.0 normalized ID derived from this manifest's publisher DID and slug.
Only those exact IDs are admitted; an arbitrary Registry-shaped ID is denied.
The storage objects are used as supplied by EmDash, with no namespace rewrite,
raw SQL, private context getter, or second order writer. These structural
checks reject obvious misbinding and do not attest an installation.

Guest request URL and declared origin/fetch metadata are admitted against
`ctx.site.url` before the resolver runs. Host site scope must agree with the
runtime site. Wake execution binds the same owner-scoped collections and
trusted host directly, without synthesizing a browser request. Both use the
existing capability, attempt CAS, persisted payment request/session, durable
payment association and canonical order writer. Unknown or failed lookup
retains the wake without ACK, stock release, or a new order.

## Callable service contract

```ts
import { createInstalledCheckoutHandlers } from "@dinkuskit/commerce/features/checkout";
import type { InstalledCheckoutServiceResolver } from "@dinkuskit/commerce/features/checkout";

// Implemented and bundled by the plugin source owner after bridge admission.
const resolveServices: InstalledCheckoutServiceResolver = async (ctx) => {
  // Resolve the approved server-only TEST assembly against this owner context.
  // Never read merchant/account/binding authority from route input.
  return approvedInstalledTestAssembly(ctx);
};
const checkout = createInstalledCheckoutHandlers(resolveServices);
// Use checkout.prepare/start/status as (routeCtx, ctx) handlers;
// use checkout.cron as the plugin's cron hook. Do not pass this closure
// through descriptor options: JSON serialization removes callbacks.
```

`approvedInstalledTestAssembly` is a required integration function, not an
implemented or attested bridge in this package. Its result is
`{ host: GuestCheckoutHostOptions, wakes?: CommercePaymentWakePort }`.
Guest and wake services must originate from one approved full TEST configuration:
`paymentsOrigin`, `siteId`, `commerceOrigin`, `bindingRef`, `providerId: "stripe"`,
`stripeAccountId`, `credentialResolver`, and scoped `fetch`. The existing
`createTrustedTestPaymentsCheckoutHost` validates TEST Stripe binding identity
and bounds actual streamed binding/session/lookup responses before parsing.
The existing Template wake client owns bounded list/ACK transport. This slice
neither copies that client into Commerce nor creates a new credential store.

## Exact remaining installation and approval boundary

EmDash 1.2.0 exposes owner storage, site, settings, and optional cron/HTTP in
registered handler and hook contexts. It provides no public cross-plugin
Payments invocation. The current approved broker URL and server credential
consumer are not specified by this repository. A callback closure in a native
wrapper cannot establish actual Registry identity or survive descriptor JSON.

The next Commerce-owned source change is to bundle the approved resolver in
the Registry artifact using a supported server credential consumer and scoped
transport. It needs the non-secret existing broker HTTPS origin and approved
consumer/selector contract, plus the existing TEST site/binding/Stripe account
association. Credential values must stay outside agent context, logs and
public source. There is no permission bypass or fabricated default.

If this resolver uses `ctx.http.fetch`, the exact minimal manifest proposal is:

```json
{
  "capabilities": ["network:request"],
  "allowedHosts": ["<hostname from the approved paymentsOrigin>"]
}
```

Replace the placeholder with the single exact approved broker hostname before
seeking approval. Do not use a wildcard or unrestricted network capability.
This was later applied with the single approved host: the manifest now
declares `network:request` and `allowedHosts: ["payments.dinkuskit.com"]`
(GrillTrack `commerce-allowed-hosts-payments-dinkuskit-com`, locked by the project owner on 2026-10-09).
`coupons.dinkuskit.com` was added beside it for the hosted coupon service
(GrillTrack `commerce-allowed-hosts-coupons-dinkuskit-com`).
A new capability/site consent, secret/credential grant, Registry publication,
or deployment is WAITING_FOR_HUMAN. An already approved consumer may be reused
only after its exact scoped contract is verified. Scheduling remains with the
site owner; do not introduce a second scheduler. No task is automatically
created by this adapter.

Admission proof must bind the immutable Registry artifact/publisher/version to
its runtime ID, routes, collections and granted host, then show that guest and
cron use the same real installed namespace and approved TEST assembly. Finally
prove one durable order and replay/closed-tab recovery against TEST Payments.
Synthetic contexts and HTTP in this slice prove compiled adapter behavior only;
config-loaded sandbox browser proof is not a Registry installation or a Stripe
purchase. Public checkout remains unavailable until that real bridge is admitted.

## Public API evidence

- Pinned `emdash@1.2.0` public types: `PluginContext`, `SandboxedRouteContext`,
  `CronEvent`, and `CronHandler`. Production imports only supported exports.
- [EmDash plugin context and cron hooks](https://docs.emdashcms.com/reference/hooks/)
- [Owner-scoped storage](https://docs.emdashcms.com/plugins/creating-plugins/storage/)
- [Network capability and host consent](https://docs.emdashcms.com/plugins/creating-plugins/capabilities/)
- [Registry identity and installation consent](https://docs.emdashcms.com/plugins/registry/)

The pinned package's published source documents normalized Registry ID
construction; production code does not import its internal helper. A regression
test derives the expected ID from this manifest and guards publisher/slug drift.
