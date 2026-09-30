# Sandbox admin review adjudication

Initial independent read-only review, 2026-09-26, against main
51ab023b14490e3bff821e5310dd1c323092df30 and exact files below.
Reviewer ran no tests. Runtime verification is separately recorded.

- required_fix: a thrown product/settings Save error removes the form. Preserve
  submitted values and retry controls without another storage read. Primary
  regression owner: real workerd/SQLite Playwright flow with a scoped SQLite
  write refusal; this reaches the production storage error and host renderer.
  Kernel tests only cover the application result, not returned Block Kit forms.
- defer: existing kernel returns stored stock status after a price-validation
  refusal, resetting a newly selected but unsaved radio. This predates the
  sandbox change. Keep the locked kernel behavior in this slice; revisit in a
  focused product-save outcome discussion. Prices remain typed and unsaved.
- reject_false_positive: native migration, live Inventory transport, a storefront
  H1 renderer, and public Registry publication are not accepted scope here.
- human_gate: publication, populated native upgrade, public deployment and merge
  remain separate owner decisions.

Initial source SHA-256:

- src/admin/index.ts: 563bbe73a33f00c6df4eedf595cee6c515ff72b2b17ca10eed6dfeace508ece6
- src/plugin.ts: 650e269958c736706519a27246f48fdfbb3449e602e680cb95f5a8f0e7c769db
- emdash-plugin.jsonc: 3bdd26ce35af47cf84606b4b517e01993c0ca60f22fd3b6dac25e9eae6bb49be
- src/features/catalog/product-admin.ts: 5f19db4a93b645be4eb77f58b504d9bbdaac9dcb6823a50f6a7fd83129191636
- src/features/catalog/storage-constraints.ts: 68cddcaa9c0ec38f89bf5346479ce2557a634ccbcf3104484032cc0ff767dff5
- tests/sandbox/commerce.spec.mjs: ced97242c020c957fa7f3bc5d843a56f657f8078dace06c2e44a4abce683d9e5

This is a findings receipt, not approval of later edits. Final source review and
red/green evidence must be attached after the recovery repair.

## Final focused review

Independent follow-up: clean, no required fixes. Recovery renders submitted
product/settings values without storage reads, retains the action identity and
Save/navigation, and does not claim rollback or success. Commerce-prefixed flat
sidebar labels are appropriate. No edits or test runs by the reviewer.

Reviewed SHA-256 (unchanged before/after review):

- src/admin/index.ts: a7a458e7fba2f630266f7c4461c9be1a3299c37b3f771f25fab64e46d43181ef
- emdash-plugin.jsonc: 531c9de5b04d6d080e81d44f9647b33ff41cb09de6b0e53d45704b3451cef23d
- tests/sandbox/commerce.spec.mjs: b0b8885259116d8963dee037b2730fbdfcf9f6d65701f847e71ec0330352506f

The operator separately ran the green regression and final full verifier:
122 unit, 19 integration and one real workerd/SQLite browser workflow passed.
The red receipt fails at product input retention before reaching the settings
scenario; both scenarios pass in the green/full receipts. Source-wide binding
and sanitized receipts: ../../proof/sandbox-admin-20260926/.

The initial broad review plus this focused repair review leave no required
source fix. Deferred kernel behavior and human publication/merge gates remain.

## Native admin continuity review

Follow-up review against branch initial head 0d120659d39e859ed4d32224b5981a18029ccb01:

- required_fix: existing native pilot data and admin access must remain usable.
  PR27 removed native descriptor adminEntry/adminPages and the package ./admin export.
  Approved direction is registry-distributed sandbox Block Kit for fresh installs, but
  native compatibility entry point must be retained pending tested migration.
  Restore native descriptor adminEntry/adminPages, package ./admin export via separate
  native compatibility entry (src/admin/native.ts), and React peerDependency.
  Preserve existing src/admin/index.ts Block Kit, sandbox plugin/manifest, and catalog kernels.
