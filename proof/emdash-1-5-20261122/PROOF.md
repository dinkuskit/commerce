# EmDash 1.5.0 proof

Taken 22 Nov 2026 by `npx playwright test` (sandbox suite) on a new EmDash
1.5.0 SQLite store with the Registry build of this branch installed.

1. `1-product-saved-on-1-5.png`: the admin footer reads EmDash v1.5.0. A
   product was created, which runs the unique-index probe that failed with
   "uniqueness unproven" before the index-name fix, and its identifiers saved.
2. `2-storefront-on-1-5.png`: the same store's storefront lists the new
   products with their pictures and the guest checkout form.

Runs on this branch: `npm test` 885 of 885, `npm run test:integration` 113 of
113, sandbox suite 12 of 12, orders-blocks suite 5 of 5. Registry backend
130758 bytes, 314 below the cap. See
[the compatibility record](../../docs/implementation/emdash-1-5-compatibility.md).
