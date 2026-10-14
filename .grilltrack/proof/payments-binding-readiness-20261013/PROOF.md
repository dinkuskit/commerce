# Payments binding readiness

## Problem and contract

Commerce 0.2.0 required a wire `ready: true` field when checking Registry
checkout readiness. Payments checks current provider readiness before returning
HTTP 200 from `/v1/checkout-binding`, then returns only the binding identity,
provider account and mode. The extra field was invented by Commerce's test
fixture. A successful real response therefore stayed unavailable.

Source contract: `dinkuskit/payments` commit
`5737d297ff050652c4375312633e7ffac97bd6e8`,
`src/hosted/connection.ts` (`checkoutBinding`) and `src/hosted/http.ts`.
No source or history from that repository was imported.

## Change

Normalize only a successful, identity- and mode-validated checkout-binding
response to the internal `ready: true` result. Preserve the installed readiness
gate and reject explicit non-true readiness values. Existing-binding reads do
not assert readiness. The compiled fixture now uses the real no-ready wire
shape for both supported providers.

## Regression

Before the adapter change, the compiled regression
`successful Payments wire binding needs no ready property` failed with
`unavailable` instead of `supported`. After the change, it passes. A second
compiled case rejects HTTP 401/409/503, null or empty bodies, binding/provider/
account/mode mismatches, and explicit false or malformed readiness values.
All cases use synthetic issuer and transport fixtures; no live credentials,
provider writes or checkout attempts were used.

The published 0.2.0 artifact was separately reproduced with successful
synthetic authentication: the real wire shape failed while the same response
with fixture-only `ready: true` passed. This proves a source defect independent
of any additional live issuer or transport failure; it does not establish the
failed stage of a specific live request.

## Release

A patch changeset is included. Package and manifest versions remain 0.2.0 until
the release workflow consumes the changeset. The release owner must ship and
install a new artifact before existing stores receive the fix. This task does
not merge, publish or deploy.

## Validation evidence

- Node 22.23.2 and locked dependencies.
- Controlled pre-fix compiled regression: 1 failed, with supported expected and
  unavailable returned.
- Post-fix compiled regression: 2 tests passed, including eleven negative
  transport/body/identity cases.
- Candidate sandbox backend: 114,362 bytes; 16,710 bytes headroom under the
  131,072-byte per-file Registry limit. SHA-256:
  `7eebc6bd18c97aa9d6b3f5d9e4bff7f82ffe991be8b9669734ae6402aebaa770`.
- Full local verification, CI and exact-revision OpenClaw/native review are
  separate delivery gates; their terminal results are recorded in the PR and
  the owner handoff, not inferred from this targeted proof.
