---
"@dinkuskit/commerce": patch
---

The Registry backend is 1,980 bytes smaller with nothing changed for stores or merchants (GrillTrack `registry-headroom-20261031`): Rolldown inlines constants and tree-shakes more strictly, the Block Kit admin builds its fields through shared helpers, the Registry build reads stock management as managed or unmanaged only, and the ISO country set is a bit table. Headroom under the 131,072-byte cap goes from 826 to 2,806 bytes.
