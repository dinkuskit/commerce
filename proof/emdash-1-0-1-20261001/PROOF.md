# EmDash 1.0.1 compatibility proof

- Base: `19913dfa9c67f750a7eeb3277262b44731e1a359`
- Branch: `codex/commerce-emdash-1-0-1-20261001`
- Package: Commerce `0.0.0`, private
- Runtime: mise Node `22.23.2`
- Fixture data: synthetic local SQLite only
- Ports: default browser `64625`/`64627`; local-stock browser `19751`

## Installed versions

`emdash@1.0.1`, `@emdash-cms/blocks@1.0.1`,
`@emdash-cms/plugin-types@0.5.0`, `@emdash-cms/plugin-cli@0.13.1`, and
`@emdash-cms/sandbox-workerd@0.9.1` were installed with exact pins and a
generated npm lockfile. The `emdash@1.0.1` integrity is recorded in the
package manifest and implementation handoff.

## Results

- `mise exec node@22.23.2 -- npm run typecheck`: PASS
- `mise exec node@22.23.2 -- npm run build`: PASS
- `mise exec node@22.23.2 -- npm run test:unit`: PASS, 235 tests
- `mise exec node@22.23.2 -- npm run test:integration`: PASS on retry, 22 tests
- `mise exec node@22.23.2 -- npm run test:sandbox`: PASS, 5 tests
- `mise exec node@22.23.2 -- npm run test:sandbox:native-local-stock`: PASS, 1 test
- `mise exec node@22.23.2 -- ./bin/verify-commerce full`: PASS on final run
- `emdash-plugin validate`: PASS

The first full verifier attempt had one transient Wrangler/D1 subprocess
failure returning an internal reference instead of the expected unique-index
text. Its retained raw log is included in the working track; the integration
suite passed on retry and the canonical full verifier passed on the final run.

## Renderer evidence

The native and workerd/sandbox browser fixtures used the installed 1.0.1 host.
They proved admin/guest behavior, storage retention, anonymous denial, and
default stock safety. Native 1.0.1 renders a real gray disabled Manage stock
slider with adjacent “Coming soon”; pointer and keyboard attempts leave it
unchanged, and the default/dormant state survives reload. The sandbox
Block Kit contract has no disabled toggle type or forwarding, so its selected
capture is the safe Coming-soon notice rather than a claimed disabled slider.
The selected original UI captures are:

| Capture | SHA-256 |
| --- | --- |
| `.tmp/sandbox-proof/emdash-1-0-1-20261001-default/manage-stock-coming-soon.png` | `f9205133a5dacf39450dc309dc800dc4e8726aaf375463bb141db862e891be36` |
| `.tmp/sandbox-proof/emdash-1-0-1-20261001-default/native-products-edited.png` | `2184481dc1bf2923e214040a7728071461b1fc5ce5827e776150a3168fa7913f` |
| `.tmp/sandbox-proof/emdash-1-0-1-local-stock/native-local-stock-enabled.png` | `50d6a03c156f02d04186f7d92c452a95f3414a34814dcd0ca74ebffda2ca08f2` |
| `.tmp/sandbox-proof/emdash-1-0-1-local-stock/native-local-stock-setup-required.png` | `cfbf1371170b327527d2814faf85ad55a5911564be805d5fee27441be51a42e1` |

The two retained `guest-checkout-*-unavailability.png` files are generic
homepage captures with their original hashes; they are excluded from current
UI proof. Guest checkout is proven by the retained HTTP and SQLite results:
configured prepare mints one capability, start fails `PAYMENTS_UNAVAILABLE`
without a cart or inventory write, and missing trusted site configuration
fails closed with `UNAVAILABLE`.

The 1.0.1 `ToggleElement` type still has no `disabled` field or forwarding.
The default Commerce native renderer therefore emits the real disabled gray
slider, while the sandbox renderer emits only the safe Coming-soon notice.
The local-stock captures are a trusted constructor/runtime/request opt-in only;
all server admission remains preserved and fail-closed.

## Packed consumer proof

Supported `npm pack` produced the ignored local artifact
`.tmp/commerce-migration-20261001/artifact/dinkuskit-commerce-0.0.0.tgz`.
It contains 243 package files; `package.json` remained unchanged after pack.

| Artifact | Digest |
| --- | --- |
| `package.json` | `sha256:0f6ca694fb3e301128c28cad176aed49eb02236d1fcea14dfae213cafe3b668c` |
| `dinkuskit-commerce-0.0.0.tgz` | `sha256:f5f7ef5d4f963565dec377c8cf61bf91d22bfba6441999e91bda4f842a8d7164` |
| `dinkuskit-commerce-0.0.0.tgz` | `sha512:4eff6a81231340eb95e599150fe547df3323792b044f2de830544195ec180f891a2cb3fc9b6da5b73e1f88e6bd69afa2a099d50a835a7f0bf4d77cf20e4ac43c` |

The fresh ignored consumer installed that tarball with supported
`npm install --save-exact` pins (no link, workspace symlink, relative
dist import, or node_modules patch). The installed versions were exact:
EmDash 1.0.1, Blocks 1.0.1, plugin types 0.5.0, plugin CLI 0.13.1, sandbox
runner 0.9.1, Astro 7.1.3, and Node 22.23.2. The consumer package, lock, config, npm inventory, raw server/failure logs,
artifact log, and original screenshots are ignored operational artifacts copied
unchanged to the private handoff area; they are not committed files or public
proof. Public proof retains only this document, `media-manifest.json`, and
`source-manifest.sha256` in this directory.

The consumer used separate normal Astro dev hosts and SQLite databases:
`consumer-astro.native.mjs` registered the installed native
`dinkusCommerce` descriptor in `plugins`, on port 20142;
`consumer-astro.sandbox.mjs` registered the installed descriptor and resolved
the installed sandbox entrypoint under `sandboxed`, on port 20143. Production
auth was not bypassed or weakened; the existing local setup/dev-auth fixture
was used only by these disposable dev hosts.

Native acceptance was actually driven to the installed Products admin. A
synthetic `Acceptance Native Product` was created through that UI. The
installed 1.0.1 renderer showed a real disabled gray Manage stock control and
adjacent `Coming soon`; forced pointer and keyboard attempts left it
unchecked. Capture: `consumer-native-products-1.0.1.png`
(`sha256:b910c51a2027f9f2e41c58ccc3f896a63f863afb77857583a72f17f9f3bd6b3b`).

Sandbox acceptance was actually driven to the installed BlockKit Products
page. A synthetic `Acceptance Sandbox Product` was created through that UI.
The installed renderer showed `Manage stock — Coming soon` with no switch or
checkbox control, and pointer/keyboard activation could not produce a live
toggle. Capture: `consumer-sandbox-products-blockkit-1.0.1.png`
(`sha256:dd748cdb1ee2e46394f608a032bf18044a0d70a6dabcdc07889a6e5e403e81b3`).
The sandbox control remains `NEEDS_HOST_SUPPORT` for a true disabled slider;
no type or renderer forwarding was claimed.

Raw acceptance logs are retained as `consumer-native-acceptance.log` and
`consumer-sandbox-acceptance.log`. The initial sandbox create attempt failed
until the normal EmDash migration index became ready; the exact
`catalog commandId unique constraint is not active` response is retained as
`consumer-sandbox-index-readiness-failure.log`, and the earlier bad
entrypoint configuration is retained as `consumer-sandbox-host-config-failure.log`.
Neither failure was reported as success. The earlier import-only page and
sandbox-only host were not used as native admin proof.

The configured local public-scope probe also passed once on owned ports 20121
and 20123. It proved one minted capability, `PAYMENTS_UNAVAILABLE` on start,
zero cart/inventory writes, and `UNAVAILABLE` with no mint when trusted site
configuration was missing.

`source-manifest.sha256` contains 387 SHA-256 entries covering all tracked
files and nonignored new files, excluding only this proof directory's metadata
and consumer evidence, its media manifest, and the manifest itself to avoid
circular hashes. The original 25 history prefixes remain preserved.

## Parent checkout results

The parent independently completed typecheck, a 74-test checkout/coupon/native-
guest-storage audit, all 25 history-prefix checks, and selected visible
inspection. The parent also verified that all 243 package files in the packed
tarball match the current root and recorded tarball SHA-256
`f5f7ef5d4f963565dec377c8cf61bf91d22bfba6441999e91bda4f842a8d7164`.
The 387-entry source inventory is `d4952c58bcc0c7c52344199b629a982e4f2af3fbea13acf5aa7c81e857a943d7`
and covers all source, including new docs, excluding only proof metadata.
No functional code or test changed after those parent checks.

Orders → Make remains the next-slice queue item only. No Commerce or shipping
implementation was added. Trusted Registry installation/publication and the
Cloudflare production pilot are `NOT_RUN`; there is no `v1-ready`, clean-review,
or merge-authority claim in this proof.

## Exclusions

No Registry publication, account login, trusted Registry installation,
provider contact, production mutation, deployment, or Commerce publication was
run. PR 2768 is open; Cloudflare production maintenance/pilot proof is
`NOT_RUN`. The built local fixture proves build/load/render behavior only; it
does not prove Registry provenance. Existing catalog, checkout, order, coupon,
fixed-bundle, CAS, capability, and fail-closed contracts remain unchanged.
