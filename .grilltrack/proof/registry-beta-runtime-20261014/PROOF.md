# Exact beta Registry runtime compatibility

## Accepted scope

Admit the one publisher-derived beta runtime ID in installed checkout and
Registry service assembly. Keep native/stable IDs and unknown-ID rejection.
Each installation uses only the storage/settings and grants supplied by its
own EmDash context. No existing store, key or live provider is changed.

The beta ID is `r_fjzjvld3ssb4j63o`, derived by EmDash 1.2.0 from the manifest
publisher and `dinkus-commerce-beta`. Stable remains `r_gshdrqaldna3r7sn`.
A test binds both IDs to the manifest publisher so identity drift fails CI.

## Reproduced and verified behavior

Before the fix, the compiled beta workerd fixture returned readiness
`unavailable`. With the exact allowlist fix, the official CLI-prepared beta
archive passes readiness, starts checkout and records a paid result through
the existing synthetic Payments transport. Its backend bytes equal the
current built backend; storage, capabilities and allowed hosts are preserved.
The test uses the archive's actual manifest and backend with declared hosts.

Unknown IDs and the unregistered bare beta slug fail before any service call.
A beta installation in the same SQLite database inherits neither stable cart
records, catalog rows nor store-key settings; reopening stable retains its cart.
The three integration cases pass with the real EmDash repository/workerd bridge.

## Release effect

The runtime fix has a patch changeset. Merging this PR can create/update a
version PR, but does not authorize that PR's merge or publication. Enter the
reviewed Changesets beta pre-mode before the later feature/release merge; hold
any stable version PR and let the version action update it for beta mode.


## Actual Payments Worker compatibility

The CLI-prepared beta backend ran in EmDash's actual workerd bridge and called
the separately compiled Payments Worker from public source
`286aeac6ec280339ddc6b51501b3fd8b3c9fd1ef`. That Worker ran with its real SQLite
Durable Object, issuer JWT verification and Stripe adapter; only the issuer
and processor replies were synthetic and intercepted locally. No provider
or deployed service was contacted.

Observed: readiness supported; checkout created; lookup reconciled paid;
wrong site rejected with 401; a different authenticated account rejected with
403. Seventeen issuer/processor requests were intercepted, zero real provider
calls. Temporary credentials were generated in memory and never retained.

- Beta backend SHA256: `48aafd378ea1ae871f2700d3853f0273640643df19fbd611c26ee1d9bb935fcf` (114481 bytes).
- Prepared beta manifest SHA256: `42a997ffef8a54a8d71dbd7970ee7123ddf0ca301e78f1c8e0e08d47a43ef609`.
- Compiled Payments Worker SHA256: `d1aeb2ccc5fcb1cdab04080efb4a5d273ffb9e9e7da5ca1587bcaeb48bfd2780`.

This qualifies the local protocol/namespace behavior, not a deployed beta
package, live grant approval, or real processor settlement. Repeat artifact
identity checks on the final release after subsequent feature integration.

## Validation

Node 22.23.2: full Commerce gate passed (565 unit tests, 97 integration tests,
10 sandbox tests, stock and Orders browser tests, native consumer and both
settings projects). The additional manifest-derived identity unit test passes
separately. Typecheck and repository/feature audits pass. Initial beta
readiness regression failed before the guard fix. The first standalone
Payments proof exposed a synthetic settlement response omission; fixing the
test response reached paid. A concurrent run hit the SDK's fixed-port limit;
rerunning after the full suite finished passed. Neither required a production
behavior change.
