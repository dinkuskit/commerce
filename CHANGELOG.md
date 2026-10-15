# @dinkuskit/commerce

## 0.3.0-beta.0

### Minor Changes

- [#117](https://github.com/dinkuskit/commerce/pull/117) [`ef2fabe`](https://github.com/dinkuskit/commerce/commit/ef2fabe429675b88cee90521616e32c0e81a310b) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Add an isolated Ship TEST profile with explicit owner admission, permanent recipient pins, and atomic cohort disable fencing for completion and acknowledgements. Preserve production configuration and existing paid orders.

### Patch Changes

- [#116](https://github.com/dinkuskit/commerce/pull/116) [`01b907a`](https://github.com/dinkuskit/commerce/commit/01b907a2be1374b0a90b252682677acbc9348e47) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Support the separately published beta package's exact Registry installation identity while preserving stable and unknown-identity admission rules.

## 0.2.2

### Patch Changes

- [#113](https://github.com/dinkuskit/commerce/pull/113) [`21be3e5`](https://github.com/dinkuskit/commerce/commit/21be3e51218cfbe0353296a1811837a07cc8d59a) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Allow a prepared guest checkout to resume on the same capability after validation rejects a start before an attempt is saved. Status confirms the absence without creating a payment session; explicit attempt hints, storage failures, and existing attempts retain their current safeguards.

## 0.2.1

### Patch Changes

- [#111](https://github.com/dinkuskit/commerce/pull/111) [`09e43c8`](https://github.com/dinkuskit/commerce/commit/09e43c856d8db29517c661597215aefc317b7370) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Recognize successful Payments checkout-binding responses without a wire `ready` field, so Registry checkout readiness can become supported after the store is configured. Preserve binding identity, provider, account, mode, and refusal checks.

- [#109](https://github.com/dinkuskit/commerce/pull/109) [`b54cac9`](https://github.com/dinkuskit/commerce/commit/b54cac9f70b3356c605e2ac94d8f1e9a2ab77ddb) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Shrink the sandboxed plugin bundle from 130,990 to 114,334 bytes (82 bytes of headroom under the 131,072-byte Registry per-file limit, now 16,738) by sharing frequent member-access property names through the build's existing literal-sharing bindings. No behavior changes.

## 0.2.0

Baseline release. Published to the EmDash Registry by hand before the
Changesets release process landed, and recorded here so generated release
notes start from the version that matches the Registry.
