# Order number, version and address correction (commerce-order-identity-001)

Measured on branch `claude/project-thread-xphlol` from main `8655f0c`, Node 22.23.2.

- `bin/verify-commerce full`: passed. Unit 495 pass, integration 46 pass, sandbox browser 10 pass, native local-stock 1 pass, Orders browser 1 pass.
- Registry bundle: `backend_bytes=123535 headroom_bytes=7537` (main was 120,348; this change adds 3,187 bytes).
- New unit tests: `tests/features/orders/identity.test.mjs` (numbering from 1001, a repeat takes no number, older orders numbered oldest paid first, address correction raises the version and keeps Checkout's copy, an outdated form is refused, incomplete or non-shipping-country corrections are refused, digital-only orders offer no correction).
- Installed browser proof (`tests/sandbox/orders-blocks.spec.mjs`): the list shows `Inspect #1001` / `#1002`; the detail shows the order ID and `Version: 1`; Correct address, change line 1, Save address shows "Address saved", the corrected address marked "(corrected)" and `Version: 2`; Orders storage holds the correction beside the unchanged paid-order copy.
