# Initial physical-delivery release scope

Decision-only follow-up from frozen country-settings source c2eaee6ff195586eab35741d08eb6b659c5fcca3. Branch codex/commerce-us-release-scope-20261008. The prior merchant-country-settings-001 history is preserved through CLI reopen/lock. No runtime enforcement is implemented or verified by this packet.

Confirmed owner direction:
- Initial physical delivery is limited to all 50 United States states plus DC, including Alaska and Hawaii. Territories and military addresses are deferred.
- Non-US billing is allowed for US physical delivery, subject to actual payment-provider and legal eligibility. A Canadian billing address with New York delivery is allowed by Commerce's release country policy.
- Unsupported physical delivery regions must be rejected before payable checkout, independently of billing-country origin.
- Tax rules remain deferred. This scope does not introduce a tax engine, nexus or rates policy.

Preserved: explicit merchant country selection, distinct selling/customer and physical-destination settings, billing-first capture, separately captured immutable billing and shipping records, independent default-off phone requirement, actual provider eligibility and controls. This direction does not establish all digital markets as eligible or enable international physical delivery.

Affected dependency: country-settings delivery-list admission and pre-payable physical checkout validation need fresh proof. Existing country settings have no country enforcement; this follow-up is a new requirement. Package architecture remains a separate pending decision, so this packet neither claims Registry installability nor selects a packaging workaround.

Bounded implementation plan: use a shared country/region eligibility operation owned by the country lane; require US and a supported state/DC code for physical delivery; connect it to the authoritative pre-payable checkout transition and merchant physical-destination admission after its precise host boundary is inspected. Demonstrate CA billing/New York delivery accepted, AK/HI/DC accepted, non-US delivery rejected, and territories/military rejected by the initial-release scope; digital-only checkout and billing-country/provider policy remain independently governed. Do not implement postal completeness or new tax/provider activation. The exact checkout integration file boundary will be reported to the coordinator before any contact/variant-owned file is edited. No overlap is authorized by this decision-only packet.

Verification here: supported CLI lifecycle and canonical validation; prior country choice remains in history; new decisions are locked with no implementation/verification/review references; source files and frozen PR68 remain unchanged. Functional tests are pending implementation. This packet claims no runtime enforcement, Registry installability, release or merge. Delivery checkpoint and exact-source review references are recorded separately.

Checks before the decision checkpoint: GrillTrack CLI validate passed; supported reopen/lock history preserves the prior country choice; new coverage/billing locks have null implementation, verification and review references; phone decision is unchanged. Node22.23.2 repository/feature audits report public_repository_contract=clean and feature_contract=clean; git diff --check is clean. Lifecycle outputs are retained locally under .grilltrack/work/us-release-scope-20261008/. Runtime tests were not run for this decision-only change.
