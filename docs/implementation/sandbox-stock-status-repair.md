# Sandbox manual stock selection repair

Accepted required fix at `5cde2b574a06db40249a2e609673f6a3d92a09b8`:
a sandbox product with dormant Out of stock is managed, then the clerk disables
Manage stock and selects In stock. The real Block Kit form_submit carries
`stockStatus: "in-stock"`, but Save drops it because the product was managed.
The successful response leaves manual availability Out of stock.

This violates the existing single-Save decision `block-admin-save-001`.
The kernel already accepts explicit manual status and restores dormant status
when the request omits it. No new product decision is needed.

The sandbox form renders the actual persisted dormant status as its initial
radio value, including when hidden by Manage stock. A submitted manual status
must reach the kernel when management is disabled. An untouched form submits
that same dormant value; a client omitting the status restores it through the
existing kernel behavior. While managed, status remains excluded.

The native React compatibility page displays an In stock default while managed
and separately tracks radio intent; it must retain that distinction. Sandbox
and native therefore use their transport's existing state representation to
meet the same contract. No new Block Kit protocol or inventory behavior is
introduced. Fresh runtime proof covers explicit choice, reload persistence,
untouched restoration, omitted-field restoration, and the native regression.

Formal exact-source review remains with its assigned owner. Checkout PR #29
and main-branch integration are separate work. Same-repository sanitized proof
is committed for public inspection; local raw logs and databases remain ignored.
