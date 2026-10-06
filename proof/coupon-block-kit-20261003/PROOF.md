# Coupon Block Kit Registry proof

## Status

`PASS (local package boundary)` — option 1 build/catalog optimization passes
official local Registry package validation. Registry installation and browser
acceptance remain `NOT_RUN`.

## Supported host facts verified

- EmDash `1.0.1` `SandboxedRouteContext.user` is host-resolved before private
  route dispatch.
- EmDash `1.0.1` attaches `PluginUiContext` for declared Block Kit admin pages,
  including `surface`, `locale`, and `direction`.
- Private route authorization uses the declared route permission before
  dispatch.
- The sandbox manifest validator accepts the added `/coupons` page and
  `coupons.normalizedCode` unique index declaration.

## Reproducible command

```text
PATH=/Users/bobbybones/.local/share/mise/installs/node/22.23.1/bin:$PATH npm run build:sandbox
PATH=/Users/bobbybones/.local/share/mise/installs/node/22.23.1/bin:$PATH node scripts/prove-coupon-package-boundary.mjs
```

The local Node 24.21.0 helper resolves the macOS native binding's signing
mismatch. CI normally uses the repository's pinned Node 22 runtime; CI for
this candidate has not run. The browser dependency prebundle fixes the earlier
temporary-probe resolution failure. The current official bundle error is:

```text
Bundle validation failed:
  - File backend.js is 211.6 KB, exceeds per-file maximum of 128.0 KB.
```

See `package-boundary.json` for exact runtime/archive bytes, SHA-256 identities,
dependency versions, and the public-helper permission matrix. The diagnostic
checks genuine upstream helpers: an Editor retains catalog permission while
coupon management requires Admin. No local role threshold is substituted.

The original `build-sandbox-failure.log` is the initial worker's reconstructed
failure summary, not raw command output, and is retained only as historical
context. It does not describe the current build result. Raw current command
outputs are retained in the ignored work directory.

## Local validation

- Source typecheck and official sandbox runtime/probe build pass.
- Decompressed runtime: `106128` bytes, SHA-256
  `14b3c850241652fd741bd5f095aa0ad87fbf658f171db8c472062b0cd351a6ae`.
- Validated archive: `30276` bytes, SHA-256
  `852dcee2ffdb63998a30611b640dfc09aa96caaf1747817397f4f33636bf55f8`.
- Focused packaging/catalog tests: 2 pass. The combined legacy coupon test
  command was not green under Node 22 because its existing better-sqlite3
  native binary targets Node 24; no dependency rebuild was performed.
- Repository and feature audits pass.
- 252 unit tests and 22 integration tests pass on the final local candidate.
- Local handler tests pass: forged body privileges are rejected before storage
  access; stale submissions retain the original CAS token and draft; the
  largest supported fixed amount renders without cent rounding.
- These checks are not proof of installed host authorization or rendering.

## Not run

- Registry installation
- Real host Block Kit rendering
- Coupon list/create/edit/disable browser flow
- Invalid-input retention, stale CAS, normalization collision, reload
  persistence, and usage proof
- Permission denial and forged/direct dispatch proof
- Browser screenshots
- Registry publication or submission
- Current candidate CI, OpenClaw review, and native ClawSweeper review
