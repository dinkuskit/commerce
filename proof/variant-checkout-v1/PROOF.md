# Variant checkout v1 proof

The merchant creates a simple product with an explicit hidden default member,
adds Size Small/Large while preserving that permanent default itemId, and
sets Small USD2000 out-of-stock and Large USD2400 in-stock independently.
An anonymous same-origin guest selects the concrete Large member and starts
through the mounted native guest routes using a disposable trusted synthetic
Payments binding. Later merchant money/status/label/fulfillment edits preserve
the frozen USD2400 payment and original Large/digital selection in the paid
canonical SQLite order and guest order projection.

## Verification

The full repository gate passes on the integrated literal-sharing build:
TypeScript; unit tests; real-storage integrations; native and sandbox browsers;
local-development stock admission; installed coupon artifact and authority
regressions. Final source gate counts and artifact hashes are recorded in the
adjacent receipt before commit. Added regressions include orphan hiding,
incompatible replay, permanent IDs and label revision conflicts, independent
bulk outcomes and stale revisions, price-only bulk admission, foreign-member
refusal, ordinary non-member bulk refusal, parent-CAS retry, same-price concurrent-write rollback protection,
immutable paid selection snapshots, and public price/listability admission
for hidden defaults and independent variant siblings.

The browser exercises actual pages, mounted routes and SQLite. Registry proof
covers merchant editing/grouping using the official sandbox artifact. Paid
browser proof covers the native disposable Payments port; shipped defaults
remain unavailable and no Registry or real Stripe paid checkout is claimed.

## Build and visual evidence

The unchanged official decompressed file cap is131072 bytes. Repeated literal
sharing preserves public field names and ordinary JavaScript operations; the
helper tests include directives, prototype syntax, imports/attributes,
tagged templates, escaped text and namespace collision cases. Official
bundlePlugin validation and actual runtime browser tests qualify the output.

Desktop1440 and phone390 screenshots were captured and inspected locally.
The adjacent visual receipt names sizes, SHA256 hashes and local generated
paths. Screenshots, SQLite files and raw logs remain disposable and untracked;
no binary proof is committed. The fixture contains only fictional products
and synthetic payment identities, and cleans only IDs it owns.

## Review and gates

This proof does not assert exact-source review or native ClawSweeper clearance.
Those receipts belong to the final pushed base/head tuple and are recorded in
the run closeout after review. Publishing, deployment, production payment,
credentials, permissions changes and merges remain outside this implementation.
The architecture dependency is same-repository PR64, now merged into main.
This implementation targets main; native clearance still requires its final
eligible base/head tuple after comprehensive review and draft readiness.
