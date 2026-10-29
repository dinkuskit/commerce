---
"@dinkuskit/commerce": patch
---

Validate and normalize historical order phone and delivery fields independently before projecting them to a shopper account or using them to seed a saved profile. Blank or unusable fields no longer create profiles that fail on their next read. Keep paid snapshots, corrected delivery precedence, older usable defaults, and explicit saved clears unchanged. Already malformed customer records still fail closed; no automatic data repair is introduced.
