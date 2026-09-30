# Native admin gate repair

The accepted P1 on PR #27 requires native descriptor registration, Products and
Store pages, and the separate `./admin` export in the earliest independently
mergeable parent. A repair only in its unmerged child #28 cannot clear #27.

The accepted P2 on #28 was reproduced against
`6f511ac1243801d44f177ade1a83383086b594ae`: open a managed product, uncheck
Manage stock, select Out of stock, and Save. The native UI omitted `stockStatus`
and the kernel restored the dormant/default status, dropping the explicit
selection. Disposition: required fix under the existing single-Save contract.
The kernel already honors an explicit status and restores dormant status when
none is supplied; the repair should distinguish those two native UI intents.

The repaired UI tracks an explicit radio choice separately from the displayed
default. Managed-to-unmanaged Save includes that choice when made and omits it
otherwise, preserving dormant restoration. Product selection and successful
reload clear the intent so another product's unsaved selection cannot leak.
Clicking an already-selected default also records explicit intent. The kernel
and sandbox Block Kit implementation remain unchanged.

## Safe composition

Retain existing history. Include the continuity commit and selected-status
repair in #27 by a same-repository fast-forward before claiming parent
readiness. Reconcile #28 against that complete parent. If #28 then has no
remaining diff, report it as redundant and leave closure to the maintainer.
No main-branch merge is part of this repair.

PR #29 owns checkout independently. Later composition must retain its checkout
feature export and test coverage alongside the sandbox build, native `./admin`
compatibility export, and current feature ownership. The GrillTrack ledgers and
events must be reconciled through the CLI, never hand-merged. These repairs do
not mount checkout or add #29's implementation prematurely. Formal review is
owned by the assigned review rail; no review is dispatched by this author.
