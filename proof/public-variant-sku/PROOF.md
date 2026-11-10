# Public variant member SKU

## Store evidence and scope
Backroad Bum's signed Registry Commerce0.8.0 exposes a Size family with distinct M/L/XL SKUs, but public members omit SKU. Template Store consequently emits the selected member's availability/price with the default member's SKU (dinkuskit/template-store#213). PR146 explicitly deferred the visible SKU line; this candidate supplies the missing authoritative fact rather than deriving it in the theme.

This focused catalog projection repair adds optional `members[].sku` to the exported type and emits the resolved member's current merchant SKU. Its validation matches the existing public family SKU bounds. No identity, schema version, persistence, permission, checkout or frozen-order rule changes. Consumers of older bundles must tolerate omission. Template Store parsing/selection and a signed release remain separate work; this does not close#213 or fix the deployed page by itself.

## Acceptance to proof

| Requirement / source | Independent expected facts | Populated pass / adverse case | Capable environment and evidence |
| --- | --- | --- | --- |
| Charter: Commerce owns variant/SKU identity; catalog-product-identity.md distinguishes mutable SKU from permanent itemId | Small and Large have different fixture SKUs and IDs | List, parent lookup and member lookup retain each member's own SKU/price/availability; editing Large's stored SKU changes only that projection | variants.test.mjs; public compiled library |
| Installed public catalog: same grouped reader and listability rules for both routes | Unpriced member is absent; listed sold-out member remains unsellable | Hidden default and nondefault SKU checks; unpriced sibling remains absent | variants.test.mjs |
| Public-safe projection: no storage record/private fields | Member DTO contains only catalogItemId/sku/selections/price/availability/fulfillment | Missing, empty, oversized, numeric and object-valued member SKU refuse; reads leave catalog unchanged | variants.test.mjs |
| Actual Registry packaging/runtime, not source import alone | Fixture default SKU PROOF-SHIRT-SANDBOX and Large SKU PROOF-SHIRT-L-SANDBOX | Anonymous list/default/member HTTP reads match fixture identities; sold-out control remains disabled | variant-checkout.spec.mjs, first test,1440/390 Chromium; actual SDK/workerd/SQLite |

## Verification
Node24.22.0, clean `npm ci` from the lockfile. Typecheck passed. Complete unit/workflow suite848/848 and integration suite111/111 passed, serialized in an isolated network namespace so default workerd ports cannot collide with the serving store. Repository/feature audits passed. Official Registry packaging passed: backend129357 bytes,1715 bytes headroom below131072; SHA256 b82190ec7fe55376820de3c0f4acefc17b20ff78b0e11be53661f468868ca7d7. Targeted first variant Playwright test passed and loops over1440/390. The full unrelated browser matrix was not run locally; CI remains required.

The initial reused dependency tree produced an oversized bundle even on unchanged upstream; a clean lockfile install fixed it. The first unisolated unit run passed847/848, with a default-workerd-port startup timeout; the complete isolated run passed848/848. Neither is reported as a framework defect or a serving incident. Screenshots/raw runner output remain ignored, not committed. No provider, hosted-payment, Registry publication or production deployment claim.
