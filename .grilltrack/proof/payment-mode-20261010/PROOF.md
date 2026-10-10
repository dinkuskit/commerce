# Test and live payments (commerce-payment-mode-001)

Measured on branch `claude/project-thread-xphlol` from main `3373a69`, Node 22.23.2.

- `bin/verify-commerce full`: passed. Typecheck and repo audits clean; unit 512 pass, integration 47 pass, sandbox browser 10 pass, native local-stock 1 pass, Orders browser 1 pass.
- Registry bundle: `backend_bytes=126284 headroom_bytes=4788` (main was 126,011; this change adds 273 bytes).
- Setting (`tests/features/checkout/registry-provider-admission.test.mjs`): `mode` test or live is admitted for Stripe and Authorize.net and reaches the Payments host; missing stays missing (test); LIVE, production, sandbox, empty, null and true are refused.
- Payments port (`tests/features/checkout/test-payments-reconciliation.test.mjs`): a live port admits only a live binding and a test or unset port only a test one, for sessions and lookups; an unknown mode refuses to build the port; the checkout host reports live, or test when unset.
- Installed workerd runtime (`tests/integration/registry-checkout-services.test.mjs`): a live setting with a live binding records `mode: "live"` on Checkout's order and Orders' copy; a test setting and a setting without mode record `test`; a live setting with a test binding, and a test or missing setting with a live binding, create no Payments session and no order; the shopper's checkout view carries no mode.
- Free order (`tests/features/checkout/checkout-pricing-recovery.test.mjs`): a zero-price order records the store's mode without asking Payments.
- Orders (`tests/features/orders/page.test.mjs`, `view.test.mjs`): Orders keeps orders with mode test or live and refuses any other value; the list, the Inspect buttons and the detail show "(TEST)" after the number for every order that is not live, and nothing for a live order. The installed Orders browser proof (`tests/sandbox/orders-blocks.spec.mjs`) now opens "Inspect #1001 (TEST)".
