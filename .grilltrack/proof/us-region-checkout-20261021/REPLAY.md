# Current-main replay of the approved US delivery rule

This is a source-preserving replay of the already approved feature, not a new product decision or a new runtime proof.

- Current main: `675a191d73648d47f0ac5eb8fe43dc6f64d62641`.
- Product base of the frozen feature: `d5b8e18d9a80fb3b65433a5c494badaad0d3b3bb`.
- Preserved frozen feature branch/source: `faa9ee6e2e122d4c4080a175d62152208279eaa3` (`codex/h2-009-refined`). Its branch, ledger and event log were not changed.
- All 606 tracked non-ledger/non-changeset source, test, documentation and configuration files match the frozen feature byte-for-byte. The common canonical path/mode/file-SHA256 manifest hashes to `99b634ea72c142f6bce3171dfb7c7c426b1088772c119aa953960e24cfa044bc`. The feature changeset and original decision/probe artifacts were also copied without alteration; only this replay note and the appended current-base proof note are new.

## History preservation

The current ledger was evolved only with the pinned repository GrillTrack CLI. Its full main event log is retained as a byte prefix. No ledger/event file was copied from the feature fork, hand-edited, reset or reconciled broadly. The approved US decision is replayed with its original meaning and frozen-source reference; the earlier conflicting physical-delivery decision is superseded through the CLI. The dependent `initial-foreign-billing-us-delivery-001` is marked `needs_reverification` by the ordinary supersede command, matching its state on the frozen feature fork; its accepted choice and prior history remain unchanged. All unrelated main decisions, including `registry-coupons-parked-20261021` and `inventory-parked-20261021`, remain unchanged.

Frozen fork history remains retrievable from `faa9ee6e2e122d4c4080a175d62152208279eaa3`: ledger SHA256 `850f5ef3ead6d7bf31b22702016c8644ac2bba497cce88d296f9cfddbc92fc41`, events SHA256 `87d81973a333cad0d65b6bac7321816906baa9f197b025a16b85443b13c8553b` (543 lines). Main prefix identity: events SHA256 `0a101f960145eb33c21ccb8d1372d6d77758fe4368e8d7f95c62163304f8d925` (543 lines). Both histories retain their common product-base prefix. These immutable source references preserve the original fork events; the active log records the new replay transitions and timestamps rather than rewriting or pretending to reproduce old events.

## Reserve and merge disposition

Main now requires at least **2200 bytes** of Registry backend headroom before merge, under the unchanged official **131072-byte** cap. The frozen feature's existing official artifact is **129554 bytes**, leaving **1518 bytes**, SHA256 `64c60e258da4e22b3bdedd30991e60cff09a1c4c8d8781d98b39aeab31a39260`.

At replay preparation, this source was **682 bytes short of the preserved reserve**. The owner subsequently approved **1518 bytes free for this feature only**; [BUDGET.md](BUDGET.md) records that explicit disposition. The general reserve and parked Coupons/Inventory decisions remain intact. No byte saving is claimed; the change is a scoped budget exception.

The prior PROOF.md remains historical evidence bound to its recorded source and artifact. This replay verifies source identity and ledger consistency only; no dependencies or expensive runtime tests were installed/run here. Current-head review, CI and any required revalidation remain outstanding. No push, PR, merge, deployment or package publication is performed or authorized by this note.

Preparation checks: the repository audit passed and GrillTrack validates. All 116 pre-existing decisions and accepted choices remain present, and each prior decision-history array is preserved as a prefix. The 543-line main event log is an exact byte prefix of the 550-line final log (7 appended events). 114 unrelated decisions remain JSON-identical. The approved replacement is verified against historical proof plus source identity; the related billing dependency remains honestly marked for re-verification. No fresh runtime execution is claimed.
