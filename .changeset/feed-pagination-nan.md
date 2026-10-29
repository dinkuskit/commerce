---
"@dinkuskit/commerce": patch
---

Reject a NaN page size in the host-side `pageProductFeedRows` helper instead of returning empty rows with an unchanged continuation cursor or silently ending traversal. Preserve the existing page-size defaults and clamping, valid cursor behavior, ordering, and nonmutation. This does not change the public catalog HTTP cursor or the Registry backend.
