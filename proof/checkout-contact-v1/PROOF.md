# Checkout contact composed candidate

Latest composed checkpoint evidence: [.grilltrack composition](../../.grilltrack/proof/checkout-contact-country-composition-20261008/COMPOSITION.md) and [main contract propagation](../../.grilltrack/proof/checkout-contact-country-composition-20261008/MAIN-INTEGRATION.md). The proof below is the retained original candidate, not current cumulative qualification.

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

Supported Node22.23.2 verification:
- Final `npm run verify:quick`: typecheck,375/375 unit tests, repository and
  feature audits passed; zero failed/skipped cases.
- Full integration:39/39 passed, zero failed/skipped.
- Official browser profiles:10/10 passed after retaining the settings owner's
  exact Save selector repair and awaiting checkout freeze before editing policy.
  Includes account-free email, missing email, optional/required phone, setting
  changes between prepare/freeze, unchanged paid money/contact and no public PII.
- Native local-stock compatibility:1/1 passed.
- Actual default workerd/SDK required-phone regression passed. Existing Registry
  runtime fixture is unchanged; native and installed overrides use original
  ctx.settings through the existing store-settings kernel export.
- Desktop and phone captures under visuals/ were inspected: fields usable,
  response contains the paid projection without original contact. The visible
  edited draft deliberately differs from the preserved paid snapshot.

Official `npm run build` succeeds but backend remains141134 bytes, SHA256
cbdc046ae5ac73f903dfb1a277fdc9566b60fa784fd07c211034c3620bea921d.
Hard cap131072 remains:10062 bytes over. The required installed coupon profile
fails before browser launch with official bundlePlugin VALIDATION_FAILED:
backend137.8KiB exceeds the per-file maximum128KiB. Full installed delivery is
blocked. No cap change, dynamic-loading workaround, new grants or validation
removal is present. Supported packaging architecture is a separate decision.

Supplementary independent Sol review found no concrete P0-P3 contact defect at
6d3146e280353ed7f95c5d939fe775c6abbfd1a4 with25/25 focused tests and read-only
legacy replay/CAS probes. Its useful gaps became retained regression tests.
Production contact source is unchanged from that checkpoint. That review is
not final-head or canonical qualification. Final-head canonical review, native
current-tuple clearance and CI remain separate gates; this PR stays draft and
must not merge while official packaging is blocked.

Every directly affected new checkout fixture now explicitly supplies synthetic
contact/requirements. Original malformed input, legacy window, Money and
provider-denial assertions remain. Existing checkout fixtures/test callers,
guest dispatch, pricing/process fixtures, installed handlers, native/Registry
integration and browser fixtures changed solely where required by the new
boundary; see changed-files.json for exact paths. Registry services integration
adds email only to two request bodies. registry-runtime.mjs is unchanged.

Commerce66 remains separately owned and is not imported or repaired here. Its
reported registry-checkout/v1 mode:test compatibility change and decision-domain
repair need external-owner reconciliation before any future source composition;
this PR does not silently normalize installed configuration or grant authority.
Settings68c2eaee6ff195586eab35741d08eb6b659c5fcca3 is an explicit dependency;
Template34 and Inventory remain separately owned. Later country/address choices
are excluded. No merge, deployment, live provider contact, sends or new grants.
