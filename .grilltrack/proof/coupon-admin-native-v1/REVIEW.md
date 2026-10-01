# Coupon admin native v1 — repair review

Review scope is the exact current uncommitted source slice, not an
independent clean review. Parent-owned source review and the official exact
commit rail remain pending; no self-independent clean-review claim is made.
The focused browser repair was re-run successfully, but that does not replace
independent review.

Standards findings:

- `required_fix` repaired: unsupported Tailwind utility styling caused
  concatenated labels, invisible control boundaries, clipped offsets, and
  indistinct actions. The page now uses accessible labels, native controls,
  inherited colors, inline boundaries, responsive wrapping, and explicit
  list/edit/usage structure.
- `required_fix` repaired: stale recovery did not own pending/error handling
  and used render-local identity comparison. Refs now gate request and
  selection application, recovery catches errors, preserves the draft, and
  pending disables editable controls.
- `reject_false_positive`: no core/kernel/shared source or dependency/config
  change was introduced by this repair.

Source-intent findings:

- `required_fix` repaired in the focused browser spec: the supported 503
  protocol fallback is asserted as `Could not load coupons: Service
  Unavailable`, the retained draft is saved as `BROWSER25-DRAFT`, and disable
  preserves all three seeded attempts.
- `defer` independent review and exact-commit binding: this worktree has no
  immutable commit identity yet.

Review identity: the current worktree has no new immutable commit. The exact
source set is bound by `source-manifest.sha256`; parent source review and the
official exact-commit rail must bind the eventual commit before delivery.
