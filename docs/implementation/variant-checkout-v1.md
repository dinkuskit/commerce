# Commerce variant checkout v1

This bounded slice keeps the permanent Commerce `itemId` as the member
identity and stores a versioned product descriptor on the default member.
Explicit products begin with one hidden default member; adding an option
publishes the default and newly-created members through a parent CAS.

Members carry independent price, manual availability, and explicit
`physical`/`digital` fulfillment. Public readers emit one grouped product with
concrete member IDs, selections, price, availability, and fulfillment. They
do not invent an aggregate price or selection. Uncommitted membership,
orphans, malformed combinations, and duplicate selections fail closed.

Checkout remains client-compatible: `CartLine` is still
`{ catalogItemId, quantity }` and `PaymentRequest` is unchanged. Commerce
stores the selected product handle, option/value labels, member ID, and
fulfillment in its attempt and canonical order snapshots. Price and option
edits therefore do not rewrite a paid order.

The editor exposes the shared option operation and versioned label CAS through
authenticated native and Registry surfaces. Bulk price writes validate each
row and return explicit outcomes; a stale price revision is a conflict, not a
silent overwrite. Legacy rows without an explicit fulfillment descriptor
remain legacy and are never assigned a fulfillment by inference.

This slice does not add Inventory quantity, contact/address capture, bundles,
customizations, Payments fields, Template writes, or a production Payments
default.

The first-choice operation is bounded to one option with two to fifty values.
Only the permanent default member may be reused; additional members are newly
created with durable parent linkage before the parent descriptor commits.
A refused parent commit can resume the same command and member identity.
Bulk edits accept price fields only and preserve stock-management and manual
availability. Per-row CAS refusal and invalid input remain explicit outcomes.

The native and Registry editors use these exported operations. Registry forms
have separate Block Kit identities; refused variant saves retain their inputs
and command/revision fences. A hidden one-member descriptor retains the simple
public price projection, while products with choices expose price only on
concrete members. Guest checkout and order projections include the frozen
Commerce selection snapshot; Payments receives its existing request shape.

The sandbox build shares repeated primitive strings and ordinary object field
names in lexical bindings. It preserves module declarations and import
attributes, directives, prototype-special keys, tagged templates and named
members. The official builder still parses and probes the module and enforces
the existing package cap. This adds no runtime decoder, dependency or grant.
