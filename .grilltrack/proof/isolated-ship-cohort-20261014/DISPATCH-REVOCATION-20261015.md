# Final Ship dispatch revocation repair

## Finding and disposition

Native review of `67b0b5b9844c947bec54d54d082a6910a12e9aa9` identified
an order-authorization race at `syncShip`'s shared transport. **required_fix**:
a prior pin read did not survive credential/current-settings waits. Settings
could remain valid while an owner disabled the order, allowing intake or event
ACK to start afterward. Receipt/completion CAS checks cannot undo those effects.
The separate clean OpenClaw result for that source did not override this finding.

Production repair `892b2d377786276e91acc4a4ff1f38130fe1288b` carries the order
identity to the shared transport and rereads its authority after both waits,
with no further await before invoking `ship.fetch`. Revoked isolated pins and
newly pinned legacy orders skip dispatch. Intake also checks the isolated
business version. Permanent pins, legacy destination behavior, and receiver
wire formats remain unchanged. This is review repair cycle 2 of 2.

## Regression and actual compiled effects

Four focused tests cover intake/ACK crossed with credential/settings waits.
All four failed on the reviewed implementation; all four pass after repair.
Together with existing shipping tests, the focused run passes 27 tests.

Actual compiled proof uses the official beta archive's unmodified manifest and
backend in the EmDash workerd/SQLite bridge, an actual issuer-signed fixture
pass, and the actual compiled Ship Worker/SQLite Durable Object. The fixture
holds the relevant host settings-repository read after the per-order pin read,
commits disable through the supported owner-only Orders route, then releases
the settings read. It does not edit the compiled entry or bypass authorization.

The redacted final-effect traces are:

| Bundle and effect | Ordered trace after reaching the wait | Final receiver effect |
| --- | --- | --- |
| Reviewed bundle, intake | settings waiting → disable committed → settings released → intake dispatched | 1 intake POST: regression fails |
| Repaired bundle, intake | settings waiting → disable committed → settings released | 0 intake POSTs; fresh receiver order absent |
| Reviewed bundle, ACK | settings waiting → disable committed → settings released → ACK dispatched | 1 event ACK: regression fails |
| Repaired bundle, ACK | settings waiting → disable committed → settings released | 0 event ACKs; 1 receiver event retained |

The ACK fixture first performs allowed intake and creates a real practice event
through Ship's public Durable Object RPC. Completion has already committed when
the final ACK settings wait starts. Disable preserves that completed business
state and its revision 2; it prevents the later ACK, rather than pretending to
undo an earlier completion. Intake disable preserves revision 1 and leaves no
local intake acknowledgement. Both paths preserve historical fixture 1001 byte
and storage revision, keep it absent in Ship, and prevent subsequent replay.

Two additional compiled runs revoke during the real issuer trade, preventing
intake/ACK and retaining the event. This trade occurs before label polling:
Registry caches the credential per sync, so these runs are not represented as
external I/O during its later cached per-order credential promise. The four
unit regressions cover that later credential/settings ordering explicitly.

## Qualification and artifact identity

Node 22.23.2 full gate passed: 593 unit tests, 99 integration tests, 10 sandbox
browser tests, 1 stock test, 3 Orders tests, native consumer, and both settings
projects. Typecheck, public repository audit, and feature audit passed.

The repaired beta archive also passes all four existing actual compiled Ship
scenarios: admitted success with completion/ACK, disable during event response,
disable before intake receipt, and scoped ordinary 422 refusal. Actual compiled
Payments/SQLite/JWT compatibility still reaches supported readiness, checkout,
and paid status, and rejects wrong site/account with 401/403.

- Backend: 117650 bytes; SHA256 `7ab9cf5c17986dc6ff6b39a561b5a7f8c97dffdf2bd44b96cf0a3afe44164eb4`.
- Prepared beta manifest SHA256: `86cbba303b8780f7a1dfc74dfa7af3404215975f89a98aa4403596992de16e5e`.
- Local fixture archive SHA256: `d8ef80740e7c7398788810f45334b2860403f4030e20a73107fb4c5a144a0b85`.
- Beta identity: `dinkus-commerce-beta`; installed runtime `r_fjzjvld3ssb4j63o`.
- Reviewed red bundle backend SHA256: `e35a92b949fd7ea644061b5400812355b298e9483ee5184cfb9d2e95483cb380`.

Ship proof makes zero payment-session, postage-provider, or unapproved network
calls. Payments processor replies are intercepted synthetic responses; no real
processor call occurs. No token or JWK is emitted or retained. No original
store, actual order 1001, shared credential, or key is accessed.

This local archive is a preparation fixture, not a predicted publication digest.
Requests already dispatched must still drain under the existing contract;
this repair does not claim distributed cancellation. Practice RPC does not
prove owner-browser authentication, purchased postage, or email/alarm effects.
History/canonical statuses remain unchanged. Fresh exact-source reviews and the
coordinator's merge, beta publication, profile authorization, and fresh-store
browser verification remain required delivery steps.
