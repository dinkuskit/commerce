---
"@dinkuskit/commerce": patch
---

Build and test against EmDash 1.6.0. The runtime peer and the recorded EmDash compatibility move to exact `emdash` 1.6.0, with plugin CLI 0.13.7 and sandbox-workerd 0.9.8. Nothing in Commerce changes: the Registry bundle is byte-for-byte the same as on 1.5.0 (131,010 bytes, 62 below the cap). The reference article says the build runs on 1.5.0 and 1.6.0, and that moving a store from 1.5 to 1.6 needs nothing from Commerce.
