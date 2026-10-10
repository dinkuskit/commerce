# Product shipping weight (commerce-product-weight-001)

Measured on branch `claude/project-thread-xphlol` from main `7bb5426`, Node 22.23.2.

- `bin/verify-commerce full`: passed. Typecheck and repo audits clean; unit 509 pass, integration 46 pass, sandbox browser 10 pass, native local-stock 1 pass, Orders browser 1 pass.
- Registry bundle: `backend_bytes=127592 headroom_bytes=3480` (main was 125,585; this change adds 2,007 bytes).
- New unit tests: `tests/features/catalog/weight.test.mjs` (typed weights in ounces are trimmed and kept with up to 2 decimals; blank clears; zero, negative, over 2400, more than 2 decimals, words, exponents, units and non-text values are refused with the ounces message; saving stores `weightOz` and changes nothing else, an unchanged weight writes nothing, clearing removes it, and an unknown item is refused; the Products page saves a weight and shows it again; a refused weight saves nothing and keeps what was typed; a weight form cannot set another product's weight or a digital product's, and digital products show no weight form; a product with choices shows one box per physical choice, and one bad weight refuses the whole form).
- Installed browser proof (`tests/sandbox/commerce.spec.mjs`): the product page shows Shipping weight with a Weight (oz) box; saving 12.5 shows "Weight saved" and keeps 12.5; typing "heavy" is refused with the weight message, the typed value stays in the box and the stored weight is unchanged (screenshot `product-weight-refused`).
