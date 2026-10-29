# Requested CLI profiles must not silently select the base site

## Identity and scope

- Baseline: upstream `04dcf5e1ef296cc9ca8d719a11fec731d6961660`.
- Repair and regression source: `501bc9aa58c914a12a6d9e4b492754350632d183`.
- Branch: `saarius/fix-cli-profile-selection`, independently based on upstream;
  it does **not** include the other separately published repairs.
- Node: `v24.22.0`; package: `@dinkuskit/commerce` `0.6.0`.
- Routine CLI configuration validation, outside the Registry runtime bundle.
  No ledger, persistence, permission, provider, dependency or release change.

## Finding

`loadConfig()` already intends to reject an unknown requested profile. However,
`selectProfile()` used ordinary property lookup and `Boolean(selected)` to
recognize a match, then spread the selected value over the file's base metadata.
Two different mistakes could therefore appear to be a successful selection:

1. `--profile constructor` matches the inherited `Object` constructor even when
   `profiles` is `{}`. Other inherited names have the same problem.
2. A malformed entry such as `"staging": "https://selected.example.test"`
   is truthy and spreadable, but contributes no `url`. Truthy numbers, booleans
   and arrays likewise fail to provide the intended override.

With a base URL in user config, either case can proceed to that base site,
including an authenticated mutation. This is an unintended destination caused
by bad profile recognition, **not prototype pollution**, a new token-authority
bypass, or proof of a deployed exploit. The existing project-config credential
restriction continues to block project-controlled destinations.

## Reproduction and repair evidence

`tests/cli/profile-selection.test.mjs` is included in `npm test`.

| Focused suite | Pass | Fail | Skipped |
| --- | ---: | ---: | ---: |
| New tests against unmodified upstream kernel | 9 | 33 | 0 |
| Repaired source | 42 | 0 | 0 |

These are Node's reported test counts, including parent subtests; they do not
represent 33 separate defects. The positive baseline controls include explicitly
defined names, empty valid overrides, precedence and help/version behavior.

Two cases start the actual executable with isolated temporary user config,
`EMDASH_TOKEN` set to a synthetic fixture credential, `--no-input`, and
`products create`. The configured base site is an ephemeral loopback HTTP
server. It checks the fixture Authorization header and passes the request to
the real catalog handler using the existing synthetic in-memory catalog store.
There is no real CMS host, customer data, external request or provider effect.

| Requested selection | Before: requests / kept Drafts | After: requests / kept Drafts |
| --- | ---: | ---: |
| Missing `constructor`, `profiles: {}` | 1 / 1 | 0 / 0 |
| Malformed `staging` string | 1 / 1 | 0 / 0 |

The tests also cover:

- inherited names in both project and user config;
- null, primitive and array selected entries, and malformed profile maps;
- environment-based selection in human, plain and JSON modes;
- explicit own `constructor`, `toString`, `__proto__`, `hasOwnProperty` and
  ordinary `staging` entries, including a matching user entry with no matching
  project entry;
- valid empty overrides and unselected malformed entries;
- profile flag over environment, explicit URL precedence, unchanged project
  credential restrictions, and help/version bypass of config loading.

### Changed behavior

Only own entries of the JSON `profiles` object count as named profiles.
Missing requested names retain `unknown_profile`, exit `2`. When selection is
requested, present profile maps and matching entries must be non-null,
non-array JSON objects; malformed metadata yields `invalid_config`, exit `2`,
with the file path and field/profile name, **not its value**, before HTTP.

Explicitly defined prototype-like names remain usable. Valid profile objects
still override base metadata, and `{}` intentionally inherits it. Without a
requested profile, base selection is unchanged; unselected entries are not
newly shape-validated by this repair. Recursive secret-key rejection remains
unchanged. Configuration precedence, credential source/trust, authentication,
confirmation gates, HTTP routes, output schema and exit-code categories are
not redesigned.

## Source-head verification

All checks were sequential on the source commit above, with dependencies
matching its unchanged lock (including development DOMPurify `3.4.16`).
Restoring the upstream development dependency for reproducibility is **not**
a vulnerability remediation or security clearance.

| Gate | Result |
| --- | --- |
| Focused profile regressions | 42/42, no skips |
| `npm test` (includes initialized build and unit/workflow/CLI tests) | 750/750, no skips |
| `npm run test:integration` (includes build) | 106/106, no skips |
| `npm run typecheck` | pass |
| `npm run audit:repo` (repository/feature contracts, not a vulnerability audit) | pass |
| `./scripts/grilltrack --project . validate` | valid |
| `git diff --check` | pass |
| Official Registry packaging validation | pass; backend identity below |

The first local orchestration exited nonzero **after** these gates because its
final reporting command referred to nonexistent `dist/sandbox/backend.mjs`.
That orchestration is not counted as a successful aggregate run. The successful
build already reported the extracted `backend.js` identity; a separate check
reconfirmed its bytes/hash and equality to `dist/sandbox/plugin.mjs`. No product
assertion was changed or suppressed to repair that reporting mistake.

Registry backend `.tmp/registry-bundle/extracted/backend.js`:

- **131033 bytes**, limit **131072**, headroom **39 bytes**.
- SHA-256: `29e86beb6d40af0050ea8e2582113aa5dc65417d355c535ac765bab0ea1ecf68`.
- Byte-identical to upstream; all runtime changes are in host-side CLI code.

A proof-only commit follows the source commit. Exact final-head verification
and the pushed hash are recorded in the review handoff; this document's table
specifically records the identified source head, not a hypothetical later run.

## Reproduce

Use Node `24.22.0`, install from the unchanged lock, then run sequentially:

```sh
npm ci
npm run build
node --test tests/cli/profile-selection.test.mjs
npm test
npm run test:integration
npm run typecheck
npm run audit:repo
./scripts/grilltrack --project . validate
git diff --check
wc -c .tmp/registry-bundle/extracted/backend.js
sha256sum .tmp/registry-bundle/extracted/backend.js
```

For the failing baseline, use a **separate disposable worktree**, not a published
repair checkout, and copy only the regression module into it before building:

```sh
git worktree add --detach ../commerce-profile-before 04dcf5e1ef296cc9ca8d719a11fec731d6961660
git show 501bc9aa58c914a12a6d9e4b492754350632d183:tests/cli/profile-selection.test.mjs \
  > ../commerce-profile-before/tests/cli/profile-selection.test.mjs
cd ../commerce-profile-before
npm ci
npm run build
node --test tests/cli/profile-selection.test.mjs
# Expected: exit 1, 9 pass / 33 fail, including parent subtests.
```

## Limits and review handoff

- This prevents new dispatches from these invalid selections. It does not
  find, delete or repair records previously written to an unintended site.
- A valid profile containing the wrong URL, or an explicitly empty alias
  inheriting base metadata, is not rejected as an invalid profile. Site
  ownership/identity verification is not added.
- Proof is local Linux executable/HTTP/catalog-fixture behavior plus the
  existing full integration suite; not browser, external EmDash installation,
  real-provider, production or Windows qualification.
- The dependency-free kernel is intended to remain synchronized across
  DinkusKit repositories. Only this Commerce fork was changed; companion
  synchronization remains a maintainer follow-up.
- CLI spec, website reference and patch changeset accompany the repair.
  No upstream issue/PR, merge, release, deployment or production mutation.
