# Review repair cycle 1

Reviewed source: `c61d63647b3eb7f990d935f170dd93eb6d1c56dd`.

## Finding adjudication

- **`reject_false_positive` — P1 native camelCase mapping.**
  `src/features/catalog/types.ts` defines
  `PRODUCT_FEED_ELIGIBILITY_COLLECTION = "productFeedEligibility"`.
  `createPlugin().storage` declares that exact computed key.
  `nativePublicContext` already reads
  `ctx.storage[PRODUCT_FEED_ELIGIBILITY_COLLECTION]` before the snake_case
  fallback. The previous fixture used that exported constant and therefore
  already provided camelCase storage. No runtime mapping repair is warranted.
  The fixture now uses the literal native key independently of the constant;
  a new test checks the schema declaration and proves camelCase wins when a
  conflicting snake_case collection is present. Both public routes pass.
- **`required_fix` — installed integration expectation omitted `feedChannels`.**
  CI's public-contract integration test expected the old exact response shape.
  The new `feedChannels: []` is intentional for an existing collection with no
  record. The expectation now includes it, and the test covers both installed
  list and item routes before opt-in, after actual merchant admin saves for
  opt-in and opt-out, and after runtime restart. The eligibility record itself
  and the two public projections agree. Existing checkout/order assertions are
  retained.

## Bounded repair

Only test and proof/ledger files changed in this cycle. No runtime source,
schema, permission, or preview-builder change was needed. The new literal-key
test is a regression against a future mapping or constant mismatch, rather
than a claim that the reviewed mapping was broken.

Focused checks passed: 10 public feed handler tests and the selected installed
workerd catalog/eligibility/checkout test. The full core result is recorded in
`PROOF.md`. Fresh coordinator review is required for the new commit; this
adjudication does not extend old exact-head review evidence to it.
