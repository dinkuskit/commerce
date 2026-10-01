# Trusted TEST Payments reconciliation proof

Final metadata freeze on 2026-10-01. The exact current source bytes remain the
parent-tested candidate in
`.grilltrack/work/test-payments-reconciliation-20261001/PARENT-CANDIDATE-SOURCES.json`.
The public Payments source contract at commit
`75e5d43acbc39deee3127f924866cb9098f789b0` was inspected with:

```sh
git -C <public-payments-checkout> show \
  75e5d43acbc39deee3127f924866cb9098f789b0:src/hosted/http.ts
```

It exposes binding lookup, existing-binding lookup, session creation, and
authoritative lookup. No wake HTTP endpoint was added. Wake identity is
`{eventId, attemptId, bindingRef, deliveryGeneration}`; Commerce associations
retain immutable `{attemptId, cartId, bindingRef}`.

## Independent full verification

The parent ran this exact reproducible command with explicit non-colliding
ports:

```sh
COMMERCE_PROOF_RUN=payments-parent-20261001-1035 \
COMMERCE_PROOF_PORT=20411 \
COMMERCE_LOCAL_STOCK_PORT=20415 \
mise exec node@22.23.2 -- bin/verify-commerce full
```

Result: exit 0, unit `245`, integration `22`, browser `5`, native local-stock
`1`. Raw stdout/stderr is retained at
`.grilltrack/work/test-payments-reconciliation-20261001/raw/parent-full-22.23.2.txt`
with SHA-256
`5e4670f0969f21c61d054a87aa0c37dc17361e7061ae0aca0029e57119c312bc`.

The earlier focused run was `6` tests on Node 22.23.1 and is historical
evidence only; its full verifier encountered the existing port-64525 collision.
The later focused final-repair run was `10` tests on Node 22.23.2. Those
historical captures remain retained and are not relabeled as the independent
full result.

The verification is synthetic for Payments/provider behavior. It uses actual
EmDash fixture storage and rendering/plugin-storage paths, disposable sqlite
databases, and synthetic IDs, clocks, catalog/payment state, and provider
responses. It is not real Stripe merchant/session/wake acceptance. No
credential, provider account, grant, deployment, or network setup was used.
The existing BaseUI uncontrolled-field warning, where present, is a
nonfailing host warning and has no source fix in this freeze.

The native case covers association-before-session CAS, storage reopen, binding
and authoritative lookup, durable order idempotency, exact event-generation
acknowledgment, retry retention, duplicate/newer events, mismatch handling,
and failed-association no-provider behavior. It does not attest a live
Payments drain/ack service or scheduler.

## Historical evidence and handoff

The first-pass proof/hash section using
`sha256:02e33c43f0f2a83f3968a5825506e4d5b59a5c694c827dca7caed4112dd935dd`
is superseded by this final freeze identity:
`sha256:ecd2401b25d871344057bd86d8fe7b01ab07aeb5f89bba433284918e3e7bef67`.
Earlier attempts and failures remain historical evidence in ignored raw
captures; none is rewritten as current.

Durable lineage is `.grilltrack/ledger.json` plus the append-only
`.grilltrack/events.jsonl`, with the original event prefix preserved.
No official clean review, commit, push, PR, merge, deployment, or delivery is
claimed. Remaining gates are the approved Payments drain/ack implementation,
host scheduler, provider grant, merchant readiness, and an actual TEST
purchase/provider wake proof.
