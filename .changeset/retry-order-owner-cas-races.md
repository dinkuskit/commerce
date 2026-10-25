---
"@dinkuskit/commerce": patch
---

Retry storage compare-and-set races on non-owner order metadata (`shipVersion`, `number`) in `change()` before reporting contention so Ship label sync never acknowledges a label without persisting order completion.
