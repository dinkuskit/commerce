---
"@dinkuskit/commerce": patch
---

A checkout with only digital items no longer reads or needs the store's shipping configuration. It already paid no shipping, but a missing or broken shipping configuration still stopped it; now only a basket with something to ship checks the configuration. The frozen pricing of a digital-only checkout records shipping as free under the configuration id `not-shipped`, revision 1, in place of the store's own configuration id and revision. A basket with at least one physical item is unchanged.
