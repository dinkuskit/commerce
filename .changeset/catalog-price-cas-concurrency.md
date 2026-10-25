---
"@dinkuskit/commerce": patch
---

Guard catalog price updates and clears with `getVersioned`, `compareAndSet`, and `compareAndDelete` retries so concurrent Regular and Sale edits revalidate invariants and never clobber sibling fields.
