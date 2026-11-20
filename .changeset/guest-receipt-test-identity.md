---
"@dinkuskit/commerce": minor
---

Expose the canonical Orders short `number` (when assigned, else `null`, or omitted when Orders cannot answer) and the paid order's explicit `test` boolean (`true` unless recorded in live mode) on authorized paid guest receipt reads (`dinkuskit/commerce#283`). Preserves cart-key authorization, frozen payment/contact/mode facts, and UUID fallback without renumbering on guest reads or inferring mode from current store settings.
