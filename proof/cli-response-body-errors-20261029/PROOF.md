# CLI response-body transport failures

## Scope and source

- Baseline: upstream `dinkuskit/commerce` main at
  `04dcf5e1ef296cc9ca8d719a11fec731d6961660`.
- Runtime: Node `v24.22.0`, dependencies installed with `npm ci` from the
  unchanged lockfile; Linux x86_64.
- Routine repair of the existing CLI exit-code contract, not a new product
  decision. No GrillTrack decisions or active focus were changed.
- Changed implementation: `cli/kernel.mjs:createHttp` only. CLI code is not
  imported into the Registry backend.

## Reproduction

Node fetch resolves when headers arrive, before the response body is complete.
Previously only the fetch call was inside the transport error handler.
`response.text()` could then reject outside it, making the CLI report
`internal_error` / exit `5` instead of the documented transport exit `3`.

A loopback HTTP server sent status 200 and a partial JSON envelope, then left
its body open. `catalog list --timeout 100ms --json` returned exit `5` with
`Unexpected error: The operation was aborted due to timeout`.

The first eleven regression tests were also run against the original kernel:
four passed and seven failed. Body timeout, cancellation and disconnection
escaped as raw errors; a custom abort reason appeared in command output.
All fixtures and transport details in these tests are synthetic.

## Repair

Both fetching headers and consuming the body now share the error boundary.
When the request signal is aborted, its reason distinguishes a timeout from
an interruption, including custom cancellation reasons and a body AbortError
caused by a timeout. Other connection failures remain `service_unreachable`.
The error messages do not include raw transport exceptions. No retries were
added. Fully received non-JSON responses still reach the contract checks.

## Verification

- `npm run typecheck`: passed.
- `npm test`: **721 passed, 0 failed**, including the build and sandbox bundle
  validation. Baseline was 708 passing tests.
- Thirteen added tests cover header/body failures, custom cancellation reasons,
  timeout-reason precedence, unchanged non-JSON handling, and real Node fetch
  over loopback for timeout, cancellation and socket closure after headers.
- Synthetic POST tests assert one send only; the real CLI tests assert one
  request, exit `3`, one JSON error and no raw exception detail in output.
- Registry backend remains byte-identical to baseline: 131033 bytes,
  SHA-256 `29e86beb6d40af0050ea8e2582113aa5dc65417d355c535ac765bab0ea1ecf68`.
- `npm run audit:repo`: public repository and feature contracts clean.
- `./scripts/grilltrack --project . validate`: valid.
- `git diff --check`: clean.

Docs: up to date. The CLI spec clarifies that timeout covers the whole response;
the reference article explains exit `3` and checking durable state after an
incomplete write response. Its release placeholders remain unchanged.

## Limits and follow-up

No browser, deployed store, Registry publication, provider transaction or
production mutation was performed. Tests do not establish that a timed-out
write failed to commit; operators must read back the product/order.

The CLI kernel is copied across DinkusKit repositories. This contribution
changes Commerce's copy only; companion maintainers should evaluate the same
small repair when synchronizing their copies. It requires no new dependency,
route, server permission or Registry bundle headroom.
