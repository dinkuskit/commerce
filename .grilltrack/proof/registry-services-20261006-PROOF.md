# Registry checkout service assembly

Decision: `installed-checkout-service-assembly-001`, composed with the accepted
installed-context and checkout-totals decisions. Baseline:
`ad84fe07c6dda1c493cc68a72c4f49cb6e179653`.

The default backend now resolves services inside the package from the original
runtime context. It uses declared encrypted settings, versioned owner
configuration, canonical Commerce storage, paired TEST Payments pricing/v1,
trusted shipping and bounded wake HTTP. Shipped capabilities and allowed hosts
remain empty. Managed Inventory remains unavailable without its transport;
no stock ledger, automatic scheduler, permanent token or issuer is invented.

## Local verification

- Node 22.23.1; pinned EmDash 1.0.1 and workerd 0.9.1.
- Typecheck, build and public repository/feature audits passed.
- Unit suite: 295 passed. The final restored default-unavailable assertion was
  additionally checked in the 11-case installed-context suite, all passed.
- Genuine compiled-default workerd suite: 10 passed. Original SDK bridge,
  encrypted settings, atomic repository CAS and manifest SQL uniqueness are
  used. Tests cover configuration/token denial, blocked empty grants, managed
  unavailability, canonical free/flat coupon totals, paid replay and order/coupon
  settlement before exact wake acknowledgment. Oversized wake data is rejected.
- Local full integration: 31/32 passed. `d1-atomicity.test.mjs` retains its
  existing constraint-name assertion; Mac Wrangler returned generic `internal
  error`, as recorded on the prior baseline. **Defer** that local diagnostic
  limitation; require the unchanged full Ubuntu CI profile on the PR head.
- General sandbox/native browser profiles: 5 passed. Explicit local-development
  stock-toggle profile: 1 passed. Installed coupon profile: 1 passed.
  Invalid-role logs in the coupon profile are expected forbidden-action probes.

## Immutable package capture

The official plugin CLI `bundlePlugin` validates the unsigned Registry tarball
without publishing it. Fresh npm and Registry tarballs contain the same manifest
and backend bytes as the tested `dist/sandbox/plugin.mjs`.

| Artifact | SHA-256 |
| --- | --- |
| npm `dinkuskit-commerce-0.0.0.tgz` | `e0d1c88ca5cf805f3795aa61ef598f1c50c893be35fd4b41aa0ac867d554e4df` |
| Registry `dinkus-commerce-0.0.0.tar.gz` | `79b64463dbb7c80012bb13fca613be0954b2387ee5ec5709a4656293dd5cfa3a` |
| Backend, 130222 bytes (limit 131072) | `6613d122e8991a462bf16538f29a287f5d243f7fd60d163c802c63f3f39eaeaa` |

Raw logs, source hash index and package receipts are retained in the ignored
`.grilltrack/work/registry-services-20261006/` run. Generated artifacts are not
committed or deployed.

## Source-intent and standards review

Parent review source identity:
`sha256:695672c4d1e516e0d47cf5ecca7d3f3bb31c40c5bc8c9dc3c8e1154e63d276d6`.
It hashes canonical sorted path/content SHA-256 pairs for the changed source,
manifest, tests and implementation document, excluding ledger/proof metadata.
The index is retained in the ignored run's `SOURCE-IDENTITY.json`.

Accepted fixes from the bounded implementation attempt: use the actual standard
`scope` claim, bound streamed wake responses, restore unconfigured behavior and
the original unavailable assertion, and replace injected context-only evidence
with actual compiled workerd execution. No required source-intent fix remains.
Reviewed issuer/claim parsing as admission filtering only; Payments authenticates
signatures. Rechecked per-call expiration, canonical origins, exact wake snapshots,
replay immutability, missing-grant unknown outcomes and untouched managed bindings.
The local D1 diagnostic limitation is deferred with the full CI requirement above.

This parent review does not substitute for exact-head CI, comprehensive P3
OpenClaw or native ClawSweeper. Their final tuple and adjudication belong to the
PR review closeout and qualified handoff. Merge remains a maintainer gate.

## Fidelity and remaining gates

The workerd fixtures explicitly use ephemeral synthetic identity and an
intercepted HTTP callback on a synthetic manifest variant. No request reaches a
provider. They prove local service assembly; they do not prove official Registry
delivery, issuer acquisition/renewal, live scheduler operation or Stripe TEST
purchase. No real setting, token or network grant is changed. The existing
Template owner receives the immutable package/context/payment-port handoff only
after source qualification. Required zero-payable orders remain the next serial
slice, followed by publication/stable slugs; neither is silently folded here.
