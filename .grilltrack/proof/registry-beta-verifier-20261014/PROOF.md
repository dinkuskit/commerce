# Registry beta verification composition

## Scope

Compose the existing published-record gate from PR #115 with the separate beta
package routing from PR #116. Preparation and verification must consume the
same effective selector. No runtime identity, storage, permission or installation
behavior changes are included. The verifier source is preserved from public
Commerce commit `316ec692b459d9dcbd81a6375ee27384a79585c3`.

## Regression

The combined workflow test failed before the correction: preparation selected
`dinkus-commerce-beta@0.3.0-beta.1`, but verification selected
`dinkus-commerce@0.3.0-beta.1`. After the correction, all 12 release-process
tests pass. Coverage includes stable and beta selectors, matching records, and
rejection of a record under the other package identity. The existing checksum,
size, gzip, verifier ordering, and failed-intent note gates remain exercised.

## Local checks

`npm run verify:quick` passes with Node 22.23.2: typecheck, all 564 unit
tests, repository audit and feature audit. Dependencies installed with `npm ci`.

## Delivery boundary

This change prepares release automation; it does not publish a package or
qualify beta runtime/storage identity, grants, routes, or payment compatibility.
Those remain prerequisites for a separate fresh-install proof. Required review
and maintainer approval apply before merge; publication remains separately gated.
