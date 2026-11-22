---
"@dinkuskit/commerce": patch
---

Build and test against EmDash 1.5.0. The runtime peer and the recorded EmDash compatibility move to exact `emdash` 1.5.0. EmDash 1.5 renames plugin storage unique indexes, so Commerce now recognizes a duplicate SKU, product command, managed-SKU claim or inventory configuration under both the 1.4 name and the 1.5 name. Without this, adding a product on a 1.5 store fails with "uniqueness unproven". The published classifiers still return plain values. The Registry bundle is 130,739 bytes (333 below the cap). The reference article now says Commerce requires EmDash 1.5.0 and that a store updates Commerce before it upgrades EmDash.
