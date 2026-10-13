# Registry release preparation

## 0.2.0

This release prepares the bounded Registry checkout-readiness route merged in
[#106](https://github.com/dinkuskit/commerce/pull/106), source
`bb9ded795f15f3ca866c514a3a4e1c70d7cfc979`. The version change does not alter
checkout behavior or the existing readiness response contract.

EmDash's [publishing contract](https://docs.emdashcms.com/plugins/creating-plugins/publishing/)
requires a minor version for new routes and treats release versions as
immutable. Publish a new `0.2.0` record; never overwrite `0.1.0`.

Read-only Registry inspection on 2026-10-12 found public, listing-passed
`@smokyco.bsky.social/dinkus-commerce@0.1.0`. Its downloaded package has SHA256
`df542fba5d84df719d05dc58fbbf1131a599f365ce956db4682383ad35fd8de3`, and its
manifest contains no `checkout/guest/readiness` route. Its backend is 128667
bytes with SHA256
`388baeaa30c45f46bdbadbb29141a039b23b104ca40cb3ca55727a1938940027`.

The supported release artifact is the sandbox package produced by
`npm run build`, including the official Registry bundle validation. Publication
uses the pinned EmDash plugin CLI and the manifest's pinned publisher identity.
The CLI must consume its own authorized session; no credentials are copied into
the repository or passed through chat. The source change must pass CI and
exact-source review before owner-authorized merge and publication.

After publication, verify the public release record, downloaded package
checksum, backend bytes and route inventory against the reviewed build. npm
tarballs are companion compatibility artifacts; npm publication is not required
for Registry installation. A published package alone does not prove a deployed
store has installed it or that hosted checkout works.

### Local verification

Using Node 22.23.2 and the pinned dependency lock, the `0.2.0` build passes the
official Registry bundle checks. Its backend remains byte-identical to #106:
130990 bytes, 82 bytes below the limit, SHA256
`cb61336de27ccf6fd6176a10be717b3f31b68ae7524f0710c82539a3c56c33d9`.
Only release metadata and the separately exported native descriptor version
change.

TypeScript, the public-source/feature audit, 542 unit tests and 98 installed
integration/route checks pass. The first integration run had one workerd
startup timeout while the unit suite was running; the full integration rerun
passed independently. These checks use local fixtures and do not establish a
published `0.2.0` release or an installed hosted checkout.
