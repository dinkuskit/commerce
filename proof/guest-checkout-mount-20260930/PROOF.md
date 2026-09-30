# Guest checkout runtime mount

- Track `gt-join-edee28c3ffe5d322451dacd0140b8af8`
- Decision `commerce-guest-runtime-mount-001`
- Retained checkout locks: `checkout-guest-001`, `checkout-hosted-first-002`,
  `checkout-stock-hold-003`, `checkout-payment-window-004`
- Base `e3d398bde103d23417c7c1a954834dadf419ec4b` (parent36 frozen draft)
- Working-tree implementation; parent owns verification, commit, push, and PR
- Source inventory: `proof/guest-checkout-mount-20260930/source-manifest.sha256`
  (all evidence metadata in this proof directory is excluded from the
  inventory; every other tracked or new public source file is included)
- Manifest identity: see `source-manifest.sha256` SHA-256 after GrillTrack
  CLI implement/verify

## Acceptance

Partial candidate requiring guest authorization/retention repairs; not admitted.
Parent independently reproduced acceptance of a known-site capability with
empty runtime site identity and a second durable attempt after discarding the
first start response and repeating without a capability. Capability retention
must precede provider contact; these required repairs remain outstanding.
Existing passing tests do not establish those acceptance criteria.

Commerce now mounts public guest
`checkout/guest/start` and `checkout/guest/status` on both native
`createPlugin` and the Registry/sandbox descriptor. Host storage declares
`checkoutCarts` / `checkout_carts` and
`checkoutGuestCapabilities` / `checkout_guest_capabilities`.
`createCheckoutStore` remains the one durable order/receipt writer.

Capability is server-minted, tenant-scoped by host storage plus optional
`ctx.site.url`, persisted as a verifier under atomic CAS, and returned in
JSON. Guessed cart/order/attempt IDs do not authorize. EmDash 0.41 public
responses strip `Set-Cookie` and reject external `Location`; Commerce does
not invent cookies or redirects. Template Store retains the JSON capability
and replays `x-commerce-guest-capability`. A Template Store HTTP-only-cookie
wrapper is allowed on their server; Commerce still mints and checks.

Default production Payments adapter is absent (`PAYMENTS_UNAVAILABLE`).
Synthetic `CheckoutPaymentPort` injection exists only in trusted fixtures.
Actual Stripe is not run. Registry/sandbox cannot invoke a Payments plugin.
Unmanaged start never contacts Inventory and does not create a store
identity. Managed without an authoritative provider stays fail-closed.
USD/card/positive totals are unchanged. The initial mount tested the historical
exact-1800 window; the current policy and focused timing proof are in
`proof/checkout-payment-window-20260930/`.

Issue 33 contact/delivery and 34 promotion remain follow-up contract work.
Shipping, tax, countries, carriers, phone, and receipt delivery remain
unresolved. v1 Manage stock slider stays implemented/unverified.
Registry disabled slider stays `NEEDS_HOST_SUPPORT`.

## Changed APIs and routes

- `POST checkout/guest/start` public
- `POST checkout/guest/status` public
- Header `x-commerce-guest-capability`
- `createPlugin({ checkout?: GuestCheckoutHostOptions })` additive
- Default route objects `guestCheckoutStartRoute` / `guestCheckoutStatusRoute`
- Kernel `startGuestCheckout` / `statusGuestCheckout` /
  `admitGuestCheckoutStartInput` / `projectGuestCheckout`
- Public contract: `docs/implementation/guest-checkout-public.md`

## Verification

First canonical `bin/verify-commerce full` under Node 22 via mise, ports
`COMMERCE_PROOF_PORT=19951` and `COMMERCE_LOCAL_STOCK_PORT=19961`:

- typecheck: pass
- unit: 182 pass
- audit:repo + audit:features: clean
- integration: 22 pass
- sandbox/native browser: 4 pass, 1 fail

The fail was `native-populated` seeing leftover `guest-hat` seed from the
new public-route spec that shares the native proof database. Raw log:
`.grilltrack/work/guest-checkout-mount-20260930/logs/06-verify-full.log`.
That first full run did not reach native-local-stock.

Focused retry after seed cleanup, ports `19971` / `19981`:

- `npm run test:sandbox`: 5 pass
- `npm run test:sandbox:native-local-stock`: 1 pass

This retry is not a second full-suite-green claim.

Existing checkout money/window/reservation/order unit and
`checkout-storage` integration tests remained in the 182/22 counts.

## Screenshot digests

Synthetic captures only. Media stays in ignored `.tmp`. Parent inspects and
uploads selected originals.

| File | SHA-256 |
| --- | --- |
| `guest-checkout-sandbox-unavailability.png` | `ea374cf1f9c0f02e17a7718a4f4c2437cedf4a90c93beead6328319c0805521d` |
| `guest-checkout-native-unavailability.png` | `15eb35a7d51292660c2502e8c2ec8b638acb8d063e2ca67f344e2ef2ea07230c` |

## Bounds

- No commit, push, PR, merge, release, or deploy
- No live Stripe, Inventory quantity, or receipt send
- No secret/env/credential inspection
- No cookie or querystring bearer capability
- No v1-ready, clean review, or closeout claim
