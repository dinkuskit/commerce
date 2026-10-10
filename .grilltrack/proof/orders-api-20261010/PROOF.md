# Agents read orders and mark them shipped (commerce-orders-api-001)

Locked on Ronald's "6. yes" (21:09:50 UTC 2026-10-10, Buildout thread). Built in 2a39cf3 on top of commerce#96 (f31fd79, merged into main as 8cbe7bf with the same tree); measured with the Ship work (c799b0f) on top, Node 22.23.2.

- `bin/verify-commerce full` on that stack: passed. Typecheck and repo audits clean; unit 526 pass, integration 51 pass, sandbox browser 10 pass, native local-stock 1 pass, Orders browser 1 pass (same run as `.grilltrack/proof/ship-sync-20261010/PROOF.md`).
- Registry bundle: 126,370 bytes before, 127,780 with the orders route (+1,410); 129,752 with Ship.
- Route (`tests/features/orders/api.test.mjs`): only administrators reach it and it keeps its route id; show returns the order with its number, version, status and test mark; list pages by order number, 50 at a time, and filters by status; complete and reopen follow the Orders page's rules at the named version and answer saved, outdated, invalid or not_found with the order as it now stands; malformed requests are refused before anything changes.
- CLI (`tests/cli/dinkus-commerce.test.mjs`): `orders list` sends one private POST per page and `--all` follows the next page; `orders show` prints one order and exits 1 for an unknown id; `orders complete` and `orders reopen` preview first and apply only at the confirmed version.
- Installed workerd runtime (`tests/integration/registry-checkout-services.test.mjs`): the compiled Registry backend declares the `orders` route as POST with `plugins:manage`; an administrator lists a paid test order (number 1001, version 1, test, shopper email), completes it with USPS and a tracking number, and sees it Completed; without a user or as an editor the route refuses.

Not covered: a real EmDash API token against a deployed store (the runtime fixture passes the user directly), and agents' use on a live install.
