# Checkout contact composed candidate

Status: implementation candidate, not accepted delivery. Email is required for
all newly frozen checkout attempts; phone is optional by default and required
by authoritative merchant settings when enabled. Existing frozen originals
replay unchanged. Contact is Commerce attempt/order metadata, excluded from
Payments requests and public checkout/status projections. Prepare alone adds
an outer `contactRequirements` hint, without revision or contact values.

Composition uses variant631d3b9fac6e55f1af4d8ff100ee48d487d83efa and merchant
settings01d8437aca7a1a17d38bf6059c06102cb265bd02 plus browser/native transport
follow-upa38968736bcfcdfa3d43c2252f19c1cecab7cdcf. Supported GrillTrack join
0799629bf6af08c280fff52618d375016555acdc8960f79b7df5bee7b8576352 preserves
56 accepted decisions and all prior events/objects. Composition invalidates
prior proof; it does not certify those decisions or close issue33.

Actual supported Node22.23.2 checks at this candidate:
- Typecheck and official `npm run build` succeed.
- `node --test tests/features/checkout/*.test.mjs tests/integration/checkout*.test.mjs`:
  122 passed, 0 failed, 0 skipped. This includes real EmDash PluginSettings
  getVersioned/CAS and native prepare/start/status tests, changed requirement
  enforcement, account-free guest denial/privacy and paid order freezing.
- Official backend141134 bytes, SHA256
  cbdc046ae5ac73f903dfb1a277fdc9566b60fa784fd07c211034c3620bea921d.
  Hard cap131072 remains:10062 bytes over. Build success is not installed
  artifact acceptance. Separate headroom work is pending.

Pending: full unit/integration/browser/audit profiles, screenshot inspection,
final composed artifact under hard cap, independent exact-source Sol review,
qualifying canonical P0-P3 review, native current tuple and CI, human merge gate.
No merge, deployment, live provider, message sends or new grants.

Test fixture adaptations are explicit synthetic contact at affected new start
call sites. Legacy payment-window assertions and malformed-cart/provider-denial
cases remain; production has no contact or settings fallback. Registry runtime
fixture remains untouched. Reserved Registry services test changes are only
explicit email in two new guest-start bodies; sibling reconciliation remains
required before final review.
