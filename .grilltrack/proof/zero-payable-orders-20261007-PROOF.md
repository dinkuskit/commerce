# Canonical zero-payable orders proof

Source intent: CLI-locked `checkout-zero-payable-order-composition-001`, composing
`coupons-v1-free-reconcile-001`, `checkout-totals-composition-001`, and
`installed-checkout-service-assembly-001`. Base: `396fb238875825d3e68fcf7a9f7860ee0ef1acee`.

Reviewed source content identity: `sha256:3eddb2bba65f311f0762dc72f05bcf88cfeb4ae5181a8430e07e03ada43f5a4a`. This is SHA-256 of sorted
canonical JSON path/content-SHA pairs for the changed source, tests and docs,
excluding lifecycle/proof files. External CI/review will bind the final Git head.

## Behavior and fit

The existing canonical checkout aggregate/CAS writes one stable order and
receipt for authoritative zero USD final totals, without a session or payment
ID. It reserves the existing coupon aggregate, persists the order first, then
supplies exact frozen identities to the existing verified-free-order owner.
There is no new money, coupon, stock, or order ledger.

Tests prove concurrent repeat convergence, interrupted order writes before
application and after application but before response, interrupted coupon
consumption, idempotent status recovery, canonical zero prices without coupons,
and no Payments resolution/creation/lookup for zero. A positive shipping charge
on fully discounted merchandise retains the positive Payments flow. Unknown
managed reservations cannot complete or consume; installation/capability/site
admission, invalid configuration/credentials and empty default behavior remain.

The compiled default backend executes under the pinned real workerd bridge and
SDK SQLite CAS. With synthetic trusted configuration/credential and shipped
empty network grants, zero checkout creates its canonical order with zero
transport calls. Missing/guessed capabilities, foreign origins and browser
totals are rejected before an order. These fixtures contact no provider or
identity service and do not prove real installed identity provisioning.

## Verification

Node 22.23.1; commands run on this source:

- `npm run typecheck`: PASS.
- `npm run test:unit` (includes build/manifest): 301 PASS.
- `npm run test:integration`: 35 PASS, including real compiled workerd.
- `npm run test:sandbox`: 5 PASS.
- `npm run test:sandbox:native-local-stock`: 1 PASS.
- `npm run test:sandbox:coupons`: 1 PASS.
- `npm run audit:repo`: PASS before commit.
- Official unsigned `bundlePlugin` and `npm pack --ignore-scripts`: PASS.

The backend is 130953 / 131072 bytes; SHA-256
`0f017b32c89f7846437c291f0b48699977617092fced426aef2016692af1c184`. Both Registry and npm archive backend bytes
match this backend. npm SHA-256 `1710d94e189d183062c36ecbccd2297a10fc12e6a4e7152c90e8674894ed4b69`;
Registry SHA-256 `76e1a16344f988728eda8617a29372fa356b08321f3422a6fc289b5b8f0182e9`. Shipped capabilities and
allowed hosts are still empty. No limit, validation or official builder changed.

## Adjudication and remaining gate

Parent standards/source-intent review accepts the bounded writer extension and
recovery/admission proof. No source finding remains. No rejected external
review finding is asserted; exact-source CI/OpenClaw/native results are separate
merge evidence. 119 bytes of backend headroom remains a concrete packaging
constraint for future source work. This source slice adds no tax, refund, expiry,
shipping-address, identity issuance/renewal or provider activation policy.
Template consumes the immutable package/guest projection handoff and owns its
installed-host proof. Product merge remains a separately authorized human gate.
