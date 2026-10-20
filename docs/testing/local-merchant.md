# Local merchant journey

Use the repository's Node 24.22.0 and install Commerce dependencies with
`npm ci`. Supply a clean isolated checkout of `dinkuskit/payments` at
`922e0de9d86ca935bdca852f44552c6c34c50203`:

```sh
npm run test:merchant:local -- --payments /absolute/path/to/payments-checkout
```

The command installs missing Payments dependencies and Chromium, preserves
Commerce's custom build, builds the actual sandboxed Payments implementation,
and runs the same Playwright journey twice. Each run starts a fresh localhost
Astro/SQLite/workerd host with independent media storage, browser contexts,
fixture identities and in-memory encryption material. The process refuses an
existing web server; it never targets a hosted merchant. Generated evidence is
under the printed `.tmp/local-merchant/<batch>/` directory. Keep it at least
14 days; there is no automatic teardown.

The journey reuses the existing merchant-settings, catalog and dev-session
patterns. It saves US merchant settings, creates a physical USD 12 parcel in
Commerce admin, connects the actual Payments sandboxed plugin, purchases as
a fresh guest with a synthetic address, observes one paid TEST order in
Commerce, reopens it to prove persistence/deduplication, delivers the payment
wake through EmDash's public hook pipeline, and verifies Payments says
Commerce recorded that same payment. Assertions use the UI and HTTP interfaces;
they never import product internals or repair product storage. A one-time host
bootstrap initializes declared indexes through EmDash's normal host method and
prepares only the initial synthetic checkout configuration.

Both descriptors load real workerd bundles. Commerce uses its generated
`./descriptor` build, separate from its native package root. Payments uses its
supported `createPaymentsPlugin({ testOnly: ... })` localhost configuration;
the implementation is bundled unchanged. This local profile is not a claim
about the default deployed Payments configuration. The profile uses the
publisher-derived Payments runtime ID to match its declared callback path.

The issuer, authorization, Payments service responses and Stripe outcome are
**synthetic fixture boundaries**. Every plugin HTTP request terminates in the
injected SDK transport, and unexpected routes fail closed. Test-only DNS replies
keep the host allowlist checks local. Ephemeral signing/encryption material
stays in memory/process environment and is omitted from evidence. Screenshots
and observable-state JSON contain generated fixture data only; traces, HAR,
browser storage state and database exports are excluded.

This is the local derivative of the new-merchant checkout/order portion of the
merchant contract. It does not certify real Stripe, account login, Registry
install/update, deployed authentication, hosted Ship, PB sandbox, provider PDF,
tracking, email, practice-label or returning-merchant cases. The order stays
Processing; it is never manually completed to imply fulfillment. The wake is
delivered explicitly through the SDK hook pipeline; timed scheduling is not
tested. Shipping is configured as free; no carrier quote or purchase occurs.

Each successful run has `PROOF.md`, `result.json`, `observable-state.json` and
safe screenshots. The batch records exact commits, package versions, lockfile,
backend and assertion hashes, `STATE.md`, `events.jsonl` and `heartbeat`.
Failed development attempts remain separate from the two acceptance runs.
