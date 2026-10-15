# Combined beta and isolated Ship qualification

## Source and scope

The integrated production tree at `da09fe50a251c2d297141daead1edf69832ff1f6`
contains the existing isolated Ship implementation, reviewed beta runtime
admission, the release-test repair, and the additive historical witness link.
This document adds evidence only; production code is unchanged after the run.

The pinned project-only GrillTrack CLI is
`9c7585f34337621d42cc508aff2e3ff317aa4e9c`. Its committed immutable history link
validates the genuine paused canonical witness without replacing current state.
Current canonical ledger/events, archives and prior lineage remain byte-identical
to the adopted `a78db4e9d99302bbadbd81a07ba207a03bfcba10` source. The historical
witness remains paused. Read-only reconciliation planning succeeds; the normal
join proposal marking 98 items for reverification was not applied. No historical
choice, approval, status, proof reference or closure was rewritten.

## Verification

Node22.23.2 full Commerce gate passed:589 unit tests,99 integration tests,
10 sandbox browser tests,1 stock test,3 Orders tests, native consumer and both
merchant-settings projects. Typecheck and repository/feature audits passed.

The actual CLI release plan retains source version0.2.2 and proposes the minor
`0.3.0-beta.0` under pre-mode tagbeta. An official local preparation fixture for
that version produces a separate `dinkus-commerce-beta` archive. It preserves
the audited backend bytes and declares the expanded isolated Ship host.

- Backend:117435 bytes; SHA256 `e35a92b949fd7ea644061b5400812355b298e9483ee5184cfb9d2e95483cb380`.
- Prepared beta manifest SHA256:`86cbba303b8780f7a1dfc74dfa7af3404215975f89a98aa4403596992de16e5e`.
- Local fixture archive SHA256:`db7e2eefa447a26e1fe98782f0ba359c460a85014b5ba599e5899e05b89d1b2e`.
- Installed beta runtime:`r_fjzjvld3ssb4j63o`.

The prepared archive's real manifest/backend run through the EmDash workerd
bridge with their declared hosts. The issuer produces an actual signed fixture
pass, and the compiled Ship Worker/SQLite Durable Object verifies it. Actual
HTTP intake, practice-event polling and acknowledgement prove:

- Owner-admitted fresh order completes and ACKs; empty admission sends nothing.
- Owner disable while a returned event is in flight prevents completion/ACK and
  retains the receiver event.
- Disable before intake acknowledgement prevents the late local acknowledgement
  and subsequent replay.
- An ordinary scoped422 refusal records a truthful handled refusal without
  retrying that version or treating it as accepted intake.
- The historical1001 fixture remains byte/version-identical and absent in Ship;
  wrong tuples, historical IDs and live-mode requests are denied.

All four runs used the actual beta installation identity. Ship proof made zero
payment-session, postage-provider or unapproved-network calls. No token or JWK
was emitted or retained.

The same prepared beta backend also crosses the actual compiled Payments Worker,
its SQLite Durable Object, issuer JWT checks and Stripe adapter with intercepted
synthetic processor responses. Readiness is supported, checkout creates, paid
lookup reconciles; wrong site returns401 and wrong account403. No real processor
call or existing installation is involved.

## Limits and delivery gates

The practice event lifecycle uses public Durable Object RPC fixtures, not owner
browser authentication or purchased sandbox postage. Email/alarm suppression is
not claimed here. This is local protocol and protection proof, not deployed
service or live-grant approval. The historical fixture is synthetic; no original
store, real order1001, key or shared credential was accessed or changed.

The local fixture archive is not a predicted published digest. Final beta release
PR version/source, official publication archive, Registry record/provenance,
expanded beta profile authorization and fresh-store browser proof remain separate
steps after exact-head source reviews and coordinator-controlled merges.
