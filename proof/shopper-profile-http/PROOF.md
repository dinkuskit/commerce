# Shopper profile GET: HTTP-boundary reproduction (unfixed)

2026-11-02 UTC. Commerce base `7094aac9ac9c2e8bef8ed7f739b3c52082e9f223`;
EmDash `1.4.0`, plugin-types `0.6.0`, plugin-cli `0.13.5`, Node `24.22.0`.
This branch contains a **failing regression/reproducer, not a fix or merge-ready PR**.

## Reproduction

Use the repository's normal dependencies and compiled sandbox build, then run:

```sh
node node_modules/@playwright/test/cli.js test tests/sandbox/shopper-profile.spec.mjs --trace=on
```

The existing canonical `tests/sandbox-site` runner creates a fresh SQLite database,
loads the compiled Commerce bundle with the normal workerd sandbox and SDK HTTP
routes, and uses the SDK development mailbox for real shopper OTP verification.
No alternate host, synthetic session row, intercepted API response or modified
Commerce route is used. The test uses HTTP requests only; no viewport claim.

The documented `GET account/profile`, with the freshly verified session in
`x-commerce-customer-session` and no request body, returns:

```text
HTTP 400
Cache-Control: private, no-store
{"success":false,"error":{"code":"INVALID_PLUGIN_REQUEST","message":"Plugin route request body is not valid JSON"}}
```

Expected: HTTP 200, `no-store`, and the same saved profile already returned by
`GET account/orders` with that session. This reproduces an earlier failure with
official Registry Commerce `0.8.1-beta.1` bytes mounted in a disposable SDK site;
neither that mounting nor this development-source run is Registry installation.
The current Template Account reader uses `account/orders.profile`, so this report
does not claim its ordinary profile display is broken.

## Controls in the same completed run

Before the final expected-200 assertion fails, the regression proves:

- Actual OTP start/verify succeed; signed-in orders GET is HTTP 200 / `no-store`.
- Profile POST updates phone, then clears phone and delivery to explicit null;
  subsequent orders GET reads those nulls.
- Malformed JSON bytes receive HTTP 400 `INVALID_PLUGIN_REQUEST`.
- A body exceeding the declared default 1 MiB receives HTTP 413.
- A valid POST without the session yields `SESSION_DENIED`.
- A cross-origin POST is refused by the host, HTTP 403 `CSRF_REJECTED`.
- DELETE is HTTP 405.
- Refused writes and the failing GET leave customer/session/order rows unchanged.
- Finally, sign-out succeeds and the formerly authorized orders GET is denied.

The final run took 1.2 seconds after fixture readiness and failed **only** at the
bodyless profile GET's expected HTTP 200 assertion. It is a red test, not a pass.
The default runner now discovers this test; do not submit/merge the branch as-is.

## Source and repair boundary

`src/plugin.ts` declares profile methods GET and POST with
`request.body: "json"`. SDK 1.4.0 parses the empty GET body before calling the
handler, returning this error. Current SDK main
`d708aa320db0ecc113494e497b4d5e657e580f49` has the same parser and one required
body mode per route, not per method. This is a declaration/transport mismatch,
not an established EmDash defect. No SDK patch or external EmDash submission.

No repair chosen: removing the declaration would also remove strict malformed
JSON handling and its body-size limit. Preserve the session header, POST update
and clear semantics, refusals, no-store behavior and these controls when choosing
a supported adapter/contract repair. The existing direct workerd invocation tests
bypass HTTP parsing, explaining why their successful profile GET did not cover it.

## Verification limits

Local `npm run build` on unchanged main emitted the library and development
sandbox, then **failed** official bundle validation: backend.js 192.7 KiB exceeds
128 KiB. This used a read-only reused existing npm dependency layout, not a fresh
install; that failure is retained separately and is not a newly diagnosed product
bug. The emitted development sandbox was used for this HTTP reproduction. No
package-admission, full-suite, release, provider-email, browser-cache or installed
release claim. An initial bare-Node SDK-runtime attempt failed on Astro virtual
imports; it was replaced with the existing canonical site, not a custom loader.
Material AI assistance: pi / OpenAI gpt-6.1-sol generated this reproducer and note.
