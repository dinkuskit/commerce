# US delivery-region policy

Owner decision recorded 2026-10-21, before implementation.

The owner accepted requiring a valid state or District of Columbia for US physical delivery, accepting state abbreviations or full names, and preserving merchant-configured non-US countries: “Yes—US validation, preserve other countries”.

This refines the initial physical delivery coverage decision in light of the later configurable-country delivery contract. Apply it at new physical checkout contact capture only. Accept all 50 states, including Alaska and Hawaii, and DC; accept codes/full names case-insensitively with surrounding whitespace trimmed. Reject missing, unknown, territory and military US regions before a new attempt write, inventory reservation or payment initiation. Store-configured shipping-country eligibility remains required, including when the country is US. Configured non-US destinations retain their current behavior.

Preserve digital-only delivery discard, replay of already frozen active attempts, shared address normalization, saved customer profiles and historical orders. No billing address is collected or used as a delivery gate. This does not calculate tax/shipping, verify deliverability, add postal-code geography, or expand a merchant's selected countries.

The feature and any instruction change still require independent source/behavior proof and review. Merge, deployment and publication are separately gated.
