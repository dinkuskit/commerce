# Payment session value equality repair

Accepted P2 on draft PR #29 candidate `7a054ea6e7a148dd0e1039ec138d967f02431ceb`,
based on `51ab023b14490e3bff821e5310dd1c323092df30`.
Branch: `codex/checkout-experience`. Repair source identity: `sha256:16f541d6a9c8fa0d0add228fad53e492d9fbb5880cc26b753c67478f89c2b7d8`
(SHA-256 of the adjacent `source-manifest.sha256`).

## Finding and disposition

Disposition: **required_fix — repaired and locally verified**. JSON object key
order previously changed the serialized session comparison. A valid processor
response with identical session field values could therefore fail paid
reconciliation, a paying retry, or confirmed expiry after late-open recovery.

Commerce now compares the immutable `sessionId`, `redirectUrl`, `createdAt`,
and `expiresAt` fields by value. Existing outcome identity, amount, URL,
1800-second window, known-session non-creation and hold-release guards remain.
The accepted previous repair still persists a recovered session through CAS
before suppressing an expired redirect; local time never authorizes release.

## Regression-first proof

- [Before repair](regression-before.txt): exit 1, four order-only cases fail
  with `Payment session changed`; real-field-change negative controls pass.
- [After repair](regression-after.txt): exit 0, all five focused tests pass.
- Cases cover reordered paid lookup, paying ensure retry preserving identity
  and deadline, ambiguous creation followed by late-open recovery and paid
  lookup, and the same recovery followed by confirmed expired-unpaid release.
  Fixtures assert deep equality and unequal JSON serialization.
- Negative controls change session ID, valid HTTPS redirect URL, or shift both
  timestamps while retaining a valid 1800-second window. Each rejects, keeps
  the attempt paying and stock reserved, and records zero release calls.
- Delegated checkout suite: 19/19 pass; typecheck and checkout-storage
  integration pass.
- Independent parent `bin/verify-commerce full` under Node 22.23.1: exit 0;
  **141 unit and 20 integration tests pass**, typecheck and public repository/
  feature audits pass. All earlier checkout regressions remain present.

`types.ts`, checkout `index.ts`, and `storage.ts` are byte-identical to the
pre-repair candidate. `PaymentSession` / `CheckoutPaymentPort` signatures are
unchanged. Interface source file SHA-256:
`b35334eb80d391d2b69c48553f8206c90de4dba11910ae857ae06bf82fb28d91`.
The separate Payments adapter must refresh against the published repaired head.

## Reproduction

```sh
npm run build
node --test --test-name-pattern 'reversed session keys|reordered|real session field changes' tests/features/checkout/checkout.test.mjs
bin/verify-commerce full
```

## Scope and review

This proof covers synthetic provider/storage behavior. Actual Payments adapter,
Stripe, runtime mounting and storefront UI evidence remain deferred. Formal
review remains pending with its assigned owner; this is author verification,
not official clean review. No review was dispatched by this repair.

GrillTrack records are updated only through its CLI. Existing product choices
and history are preserved. The composition rehearsal plan and input snapshots
remain unchanged. This repaired head is a new input for later coordinated
integration, not a composed or merged result.

Operational logs and ACP receipts remain in the ignored owned run. ACP reports
completion and local worker termination; backend session discard is unsupported.
