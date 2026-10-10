# Orders inspection preview

This is a synthetic, read-only inspection slice. It uses the existing EmDash BlockRenderer and a pure Block Kit response module. It does not register a page, read storage, authenticate requests, or alter checkout. No installed-admin, Registry, payment-provider or fulfillment claim is made. Every fixture identity is synthetic; no customer information is invented.

From the repository root after npm ci, run with Node 22.23.2:

    node tools/orders-preview/serve.mjs

Open http://127.0.0.1:47831. The server binds only loopback and refuses an occupied port. Stop with Ctrl-C. Do not expose this Vite development server publicly.

    npm run build
    node --test tests/features/orders/view.test.mjs
    ORDERS_PROOF_DIR=/absolute/path/outside-checkout node tools/orders-preview/prove.mjs

The browser proof uses the real upstream renderer, checks keyboard list/detail/back, provider-paid and zero-payable examples, empty/unavailable states, mobile overflow and browser errors. Captures are synthetic. Preview-only CSS is not installed-admin styling. The installed authenticated controller now supplies canonical CommerceOrder records and interprets orders.open:<encoded order ID> / orders.list. Its integration and pagination proof lives in tests/integration/orders-inspection.test.mjs and the installed coupon/Orders profile; this preview remains renderer-only.

Test value: these focused tests protect exact identity and amount projection, legacy missing-breakdown behavior, unsafe-money refusal and distinctions between payment and fulfillment. No existing Orders view owner exists. They exercise the public projection/renderer rather than source strings or a production test seam.
