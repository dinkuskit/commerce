# US physical-checkout region proof

Implementation source: `446668c914dcfe9735d9ab090c1e1d8121849bd6`.
Baseline: `d5b8e18d9a80fb3b65433a5c494badaad0d3b3bb`.
Environment: Node 24.22.0, EmDash 1.2.0, sandbox-workerd 0.9.3.

The owner-approved rule applies only when new physical checkout captures a US
address. All 50 states and DC are accepted by code or full name, without case
sensitivity and after outer trimming. Country configuration remains authoritative.
Shared address normalization, saved profiles, historical orders, digital-only
checkout and frozen active-attempt replay remain unchanged.

## Observed acceptance

| Requirement | Evidence |
| --- | --- |
| Complete accepted/rejected region set | Independent `region-acceptance.mjs`: 239 passing cases covering all 51 jurisdictions, codes/full names/case/trim, missing/unknown/territory/military/prototype-name refusals |
| Other countries and shared normalization | Same probe proves configured Canadian address without region, disabled-country refusals, digital malformed-address discard, and unchanged shared normalization |
| Refusal before side effects | Focused native/guest tests and full integration pass; browser rejects missing/unsupported US regions with unchanged cart rows, then accepts a mixed-case full state name |
| Full repository behavior | `bin/verify-commerce full`: 642 unit tests, 103 integration tests, 10 sandbox/native browser tests, 1 native-stock test, 3 Orders tests, native npm consumer proof and 2 settings tests pass, with no test skips |
| Packaged artifact | Repeated official builds: 129554 bytes, 1518 bytes free under the unchanged 131072-byte cap; SHA256 `64c60e258da4e22b3bdedd30991e60cff09a1c4c8d8781d98b39aeab31a39260` |
| Local merchant completion | Two fresh local databases/browser contexts load these exact Commerce bytes and Payments 922e0de9d86ca935bdca852f44552c6c34c50203, then each observes one durable paid synthetic order |

Reproduction:

```sh
npm ci
bin/verify-commerce full
node .grilltrack/proof/us-region-checkout-20261021/region-acceptance.mjs .
npm run test:merchant:local -- --payments /path/to/clean/qualified-payments-checkout
```

If dependencies were installed using `--ignore-scripts`, run `npm rebuild workerd`
before runtime proof. Its supported install hook replaces the JavaScript launcher
with the native executable. Without that hook an orphaned child can retain the
SDK's fixed port 18788. Run SDK suites serially; no forced-exit flag was used.

The first full browser run exposed a test storefront that did not collect region.
The shared storefront/merchant fixtures and their browser assertions were repaired;
then the entire full command passed. No failure was converted into a skip.

Baseline official size was 128798 bytes. This feature adds 756 bytes. A parallel
implementation adds 762 bytes and also passes full verification; the six-byte
comparison does not justify promoting additional generic agent instructions.

These are local compiled/native and browser proofs. The merchant runs use a
synthetic Payments service: no real Stripe charge, shipment, email, Registry
publication, deployment or released-artifact pairing is claimed. Required current
PR reviews and CI are recorded on the PR; this document grants no merge authority.

## Current-main replay and reserve gate

The feature was subsequently replayed unchanged onto main `675a191d73648d47f0ac5eb8fe43dc6f64d62641`. See [REPLAY.md](REPLAY.md) for exact source equivalence, retained fork/event identities and current verification limits. The prior runtime results above were not rerun during that preparation.

The current main decision preserves a 2200-byte Registry backend reserve. This feature's measured 1518-byte headroom is 682 bytes short; owner budget disposition is required before merge. Coupons and Inventory remain parked. This note does not weaken the cap/reserve or claim new-head review/CI completion.
