---
"@dinkuskit/commerce": minor
---

Commit catalog price, manual availability, submitted feed choices and multi-choice weight saves atomically within the default sandbox budget. Reject stale forms and distinguish a confirmed save from a failed panel refresh or unknown write outcome.

Existing values are read through until saved into the product record. Direct kernel price, availability and feed readers require the catalog reader as their third argument. Older binaries must not write concurrently or be installed as a downgrade without a data conversion.
