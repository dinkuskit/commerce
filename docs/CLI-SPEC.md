# `dinkus-commerce` CLI Specification

Status: Locked for the scaffold slice (`commerce-cli-scaffold-001`). Write
commands remain planned.

An unpublished scaffold executable implements the read commands below against
the HTTP routes Commerce already serves; see
[Implementation status](#implementation-status). The shape mirrors the locked
`dinkus-inventory` specification (global flags, JSON envelope, plain records,
exit codes, config precedence, credential handling). Differences are listed in
[Differences from dinkus-inventory](#differences-from-dinkus-inventory).

## Name and purpose

Executable: `dinkus-commerce`

Package: `@dinkuskit/commerce` (private, unpublished)

One-liner: read a DinkusKit Commerce catalog and products on an EmDash site
through the same plugin routes the storefront and admin use.

`dinkus-commerce` is an HTTP client, not a second Commerce engine. It never
opens EmDash storage, imports Commerce source, or reimplements price,
sellability, or availability rules. A future umbrella `dinkus commerce ...`
command may delegate to it; the `dinkus` executable is not claimed here.

## Implementation shape

```text
bin/dinkus-commerce.mjs   executable entrypoint
cli/kernel.mjs            shared DinkusKit CLI kernel, byte-identical across repos
cli/spec.mjs              command tree, flags, help text, output formatting
cli/client.mjs            Commerce plugin-route HTTP client
tests/cli/                node:test tests, run by npm run test:unit
```

The CLI is plain, dependency-free ESM so it runs without a build. It lives in a
top-level `cli/` directory rather than `src/cli`: `src/` is the TypeScript
package tree that `tsc` compiles to `dist/`, that `FEATURE_MAP.md` assigns to
features, and whose `src/plugin.ts` is the Registry bundle entry. Keeping the
CLI outside it makes the bundle boundary physical (see
[Bundle budget](#bundle-budget)).

The manifest maps the executable:

```json
{ "bin": { "dinkus-commerce": "./bin/dinkus-commerce.mjs" } }
```

The CLI is deliberately not in the package `files` or `exports`. Publishing is
out of scope until the package itself is published.

## Usage

```text
dinkus-commerce [global flags] <noun> <verb> [arguments]
```

`-h`/`--help` (and `dinkus-commerce help <command>`) shows help for the named
command and ignores every other argument. `--version` prints only the installed
version to stdout. Both exit `0`.

## Command tree

```text
dinkus-commerce catalog list [--cursor <cursor>] [--all]
dinkus-commerce catalog show <item-id>

dinkus-commerce products list
dinkus-commerce products set-price <item-id> --amount <decimal>        (planned)
dinkus-commerce products set-sale-price <item-id> --amount <decimal>   (planned)
dinkus-commerce products set-sku <item-id> --sku <sku>                 (planned)

dinkus-commerce orders list [--cursor <cursor>]                        (planned)
dinkus-commerce orders show <order-id>                                 (planned)

dinkus-commerce settings show                                          (planned)
```

Every route is served at
`<site-url>/_emdash/api/plugins/<plugin-id>/<route>`.

### Read commands

- `catalog list` reads `GET catalog/public`, the public storefront projection.
  It sends no credential. A page holds at most 50 storage rows and can return
  fewer products, or none, because unpriced or unlisted rows are filtered out.
  Without `--all` it prints one page and, when more exist, the next cursor.
  `--all` follows every cursor from `--cursor` (or the first page) to the end
  and returns one combined list; a repeated cursor is a contract violation.
- `catalog show <item-id>` reads `GET catalog/public/item?itemId=<item-id>`.
  The service returns `null` for a missing, unpriced, or unlisted product; the
  CLI reports that as `not_found` and exits `1`.
- `products list` reads `GET catalog-items/list` with the credential. It returns
  every product with Regular and Sale as dollar strings, Manage stock, the
  manual stock status for unmanaged products, and variant members. Only the
  native Commerce build mounts this route. On a Registry (sandboxed) install the
  site answers `404` and the CLI exits `1` with `route_not_available`, because
  that build only has the Block Kit admin.

Both public routes are mounted only by the Registry (sandboxed) build
(`src/plugin.ts`); the native build (`src/index.ts`) does not mount them. One
install therefore serves either the `catalog` commands or `products list`, not
both. Making both builds serve the same read surface is a Commerce decision,
not a CLI one.

### Planned commands

Planned commands appear in help with a summary ending in `(planned)`. They
accept their documented arguments, then exit `1` with code `not_implemented`
and a message naming the missing API. They never contact the site.

| Command | Missing API |
| --- | --- |
| `products set-price` | A preview/confirm route for Regular price. Native `catalog-items/set-regular-price` applies immediately. |
| `products set-sale-price` | A preview/confirm route for Sale price. Native `catalog-items/set-sale-price` applies immediately. |
| `products set-sku` | A preview/confirm route for SKU changes. Native `catalog-items/set-sku` applies immediately. |
| `orders list`, `orders show` | Any JSON orders route. Orders are shown only on the Block Kit admin page through the `admin` route. |
| `settings show` | A read-only settings route. Native can read `settings/out-of-stock-listing` and `settings/placeholder-image` but not `settings/storefront-availability`; the Registry build has none. |

### Mutations need Commerce preview/confirm routes first

DinkusKit CLIs never send a mutation without a server-side preview. The
intended flow matches Inventory:

1. `--dry-run` asks Commerce for a preview of the exact normalized change. The
   preview returns the current and proposed values, the record revision it is
   bound to, and an opaque confirmation value with an expiry. Nothing changes.
2. A real run shows that preview and asks the operator to type the
   confirmation value, or, with `--no-input`, requires
   `--confirm <value>` from a fresh dry run.
3. Commerce applies the change only if the confirmation still matches the same
   item, amount, and revision.

There is no generic `--force`. The native `catalog-items/set-*` routes apply
immediately and return no confirmation binding, so the CLI cannot satisfy this
flow yet. Commerce needs preview and confirm routes (names to be decided
through GrillTrack) before any mutation is wired. Mounting new JSON admin
routes in the Registry build would add bytes to `dist/sandbox/plugin.mjs`, so
that decision must also respect the Registry file-size budget.

## Global flags

| Flag | Contract |
| --- | --- |
| `-h`, `--help` | Show help for the named command; ignore other arguments. |
| `--version` | Print only the installed version. |
| `--url <site-url>` | EmDash site URL, such as `https://shop.example`. Must be `https` (plain `http` only for `localhost`, `127.0.0.1`, `[::1]`); no credentials, query, or fragment. Required from flag, env, or config. |
| `--plugin-id <id>` | Commerce plugin id on that site. Default `dinkus-commerce`. Lowercase slug, at most 64 characters. |
| `--profile <name>` | Select non-secret `url` / `plugin-id` metadata from config files. |
| `--json` | Emit exactly one JSON document to stdout. Mutually exclusive with `--plain`. |
| `--plain` | Emit stable tab-separated `key=value` records. Mutually exclusive with `--json`. |
| `--no-input` | Never prompt. A missing confirmation fails closed. |
| `--no-color` | Disable color. `NO_COLOR` and `TERM=dumb` do the same. The scaffold prints no color. |
| `--timeout <duration>` | Network timeout such as `1500ms`, `15s`, or `1m`; default `15s`, maximum `10m`. |

## Command flags

| Flag | Command | Contract |
| --- | --- | --- |
| `--cursor <cursor>` | `catalog list`, `orders list` (planned) | Opaque page cursor from a previous page, 1-1024 characters. |
| `--all` | `catalog list` | Follow every page and return one combined list. |
| `--amount <decimal>` | `products set-price`, `products set-sale-price` (planned) | USD amount such as `19.99`. Required. |
| `--sku <sku>` | `products set-sku` (planned) | New unique SKU. The permanent item id never changes. Required. |
| `--dry-run` | planned mutations | Preview only; send nothing. |
| `--confirm <value>` | planned mutations | Apply only if it matches a fresh preview. |

## Output contract

Requested data goes to stdout. Errors, the next-page hint, and diagnostics go
to stderr. Human output is a padded table or `key  value` lines for people and
may change. Control characters in merchant text are shown escaped
(`\u0009`), never sent to the terminal raw.

`--json` emits one document and nothing else on stdout:

```json
{
  "schema": "dinkuskit.commerce.cli/v1",
  "command": "catalog.list",
  "outcome": "ok",
  "context": { "siteUrl": "https://shop.example", "pluginId": "dinkus-commerce" },
  "data": {
    "products": [
      {
        "id": "item_demo",
        "name": "Demo Mug",
        "sku": "MUG-1",
        "price": { "currency": "USD", "minor": "1800" },
        "availability": { "status": "in-stock", "sellable": true, "listable": true },
        "image": null,
        "gallery": []
      }
    ],
    "cursor": "opaque_next_page"
  }
}
```

The envelope always has `schema`, `command`, `outcome`, and `context`. Reads use
`outcome: "ok"` and `data`. `data` passes the service payload through
unchanged: `catalog list` adds `pages` with `--all` and omits `cursor` on the
last page, `catalog show` is one product, and `products list` is the native
`{ products, manageStockControl }` payload. A failure uses
`outcome: "error"` and `error: { code, message }`, with `context` when the site
was resolved:

```json
{
  "schema": "dinkuskit.commerce.cli/v1",
  "command": "catalog.show",
  "outcome": "error",
  "context": { "siteUrl": "https://shop.example", "pluginId": "dinkus-commerce" },
  "error": { "code": "not_found", "message": "No listable public product has item id item_gone. It may not exist, or it is not priced or listable." }
}
```

`--plain` prints one record per line. Every record starts with `schema`,
`command`, and `outcome`. Tabs, newlines, carriage returns, and backslashes in
values are escaped as `\t`, `\n`, `\r`, and `\\`. Records per command:

- `catalog list`: `record=product id sku name price.minor price.currency availability.status availability.sellable variants`,
  then `record=cursor cursor` when another page exists.
- `catalog show`: one record of flattened `context.*` and `data.*` fields;
  arrays are JSON.
- `products list`: `record=product catalogItemId sku name regular sale manageStock stockStatus variants`.
- Any failure: `code message`.

JSON and plain field names are compatibility surfaces within
`dinkuskit.commerce.cli/v1`; new optional fields may be added.

## Exit codes

| Code | Meaning in `dinkus-commerce` |
| --- | --- |
| `0` | Successful read. |
| `1` | Ordinary failure with no change: `not_found`, `route_not_available` (HTTP 404), `not_implemented`, a 4xx business error, or `page_limit`. |
| `2` | Usage: unknown command or flag, missing argument, `--json` with `--plain`, invalid `--url`, `--plugin-id`, `--cursor`, `--timeout`, missing site URL, invalid or secret-bearing config. |
| `3` | Site unreachable, timeout, interrupted, or HTTP 5xx. |
| `4` | Credential missing (`credential_required`), rejected (401), or not permitted (403, including `INSUFFICIENT_SCOPE`), an admin command whose site URL came from project config (`untrusted_site_url`), or a confirmation gate. |
| `5` | The response is not the EmDash `{ success, data }` envelope or the payload breaks the documented shape. |

Service error codes such as `INVALID_TOKEN` or `INSUFFICIENT_SCOPE` are passed
through as `error.code`.

## Configuration and authentication

Non-secret configuration precedence is:

```text
flags > environment > project config > user config > built-ins
```

- Flags: `--url`, `--plugin-id`, `--profile`.
- Environment: `EMDASH_URL` (same variable as the upstream `emdash` CLI) and
  `DINKUS_COMMERCE_PROFILE`.
- Project config: `.dinkuskit/commerce.json` in the working directory.
- User config: `$XDG_CONFIG_HOME/dinkuskit/commerce/config.json` (default
  `~/.config/...`).
- Built-ins: `plugin-id` = `dinkus-commerce`, timeout `15s`. There is no
  built-in site URL.

Config files are JSON objects with optional `url`, `plugin-id`, and named
`profiles`:

```json
{
  "url": "http://localhost:4321",
  "profiles": {
    "staging": { "url": "https://staging.shop.example" }
  }
}
```

A config file containing a token, secret, password, authorization, credential,
API key, or cookie key is rejected with exit `2`.

The credential comes only from `EMDASH_TOKEN`, the variable the upstream
`emdash` CLI uses. It is an EmDash personal access token sent as
`Authorization: Bearer`. Private plugin routes require the `admin` scope,
and `products list` requires a user with
`content:edit_any`. Future non-GET admin calls also send `X-EmDash-Request: 1`
(EmDash's CSRF header). There is no `--token` flag, no token in config, and no
printing of the token or the authorization header. Public `catalog` reads never
send the token, even when it is set. Admin commands without it exit `4`, naming
`EMDASH_TOKEN`.

Admin commands send the token only to a site URL from `--url`, `EMDASH_URL`,
or user config. Project config comes with the working directory (a cloned
repository, for example), so when it supplies the URL an admin command exits
`4` with `untrusted_site_url` before sending anything. Public `catalog` reads
may still use a project-config URL because they carry no credential.

## Examples

Fictional site and ids.

```sh
# One page of the public catalog, as a table.
dinkus-commerce --url https://shop.example catalog list

# Every page, piped to jq: SKU and price in cents.
dinkus-commerce --url https://shop.example catalog list --all --json \
  | jq -r '.data.products[] | [.sku, .price.minor] | @tsv'

# Continue from a cursor printed by the previous page.
dinkus-commerce --url https://shop.example catalog list --cursor opaque_next_page --plain

# One product by its permanent item id.
dinkus-commerce --url https://shop.example catalog show item_demo --json

# Out-of-stock products in a script, using a configured profile.
dinkus-commerce --profile staging catalog list --all --plain | grep 'availability.status=out-of-stock'

# Admin product list on a native install; EMDASH_TOKEN comes from your secret manager.
EMDASH_URL=https://shop.example dinkus-commerce products list

# Local development site served over loopback http.
dinkus-commerce --url http://localhost:4321 catalog list

# Planned today: exits 1 with not_implemented and sends nothing.
dinkus-commerce --url https://shop.example products set-price item_demo --amount 19.99 --dry-run
```

## Non-goals

- Publishing the CLI. The package is private; the CLI is not in `files` or
  `exports`.
- Any byte in the Registry bundle `dist/sandbox/plugin.mjs`.
- Direct storage or database access, importing Commerce source, or
  reimplementing price, sellability, availability, or checkout rules.
- Mutations without a Commerce preview/confirm route, and a generic `--force`.
- Shopper operations: guest checkout `prepare`/`start`/`status`, carts, coupons,
  and payments.
- Media upload, product creation or deletion, and Inventory stock operations
  (use `dinkus-inventory`).
- Shell completion, color, pagers, and progress output in the scaffold.

## Bundle budget

The Registry backend `dist/sandbox/plugin.mjs` must stay under the EmDash
Registry per-file size limit, so the CLI must add zero bytes to it.

- The CLI ships outside it. `scripts/build-sandbox.mjs` bundles only the module
  graph reachable from `src/plugin.ts`. The CLI lives in `cli/` and `bin/`,
  outside `src/`, and nothing in `src/` imports it. `tsc` compiles only
  `src/**/*.ts`, so the CLI is not in `dist/` either.
- `cli/` imports only `node:` built-ins and its own sibling modules. It does not
  import `src/`, `dist/`, or any dependency.
- `tests/cli/dinkus-commerce.test.mjs` enforces this: it checks every CLI import
  specifier, that no file under `src/` references the CLI modules, and that the
  built `dist/sandbox/plugin.mjs` contains neither the CLI schema id nor
  `EMDASH_TOKEN`.
- Verified when the scaffold landed, after merging main at `717c895`, and again
  after rebasing onto main at `eafd3e8` (coupon deferral, #75): `main` alone and
  this branch build byte-identical `dist/sandbox/` files. At `eafd3e8`,
  `plugin.mjs` is 102,045 bytes, sha256
  `f70eab9e628a1df5caccbedfab4c6826bd5dab30e371982d0602f2946ec4ac49`. The `bin`
  entry added to `package.json` is copied into the sandbox build stage but does
  not change the output.

To re-verify, run `npm run build`, record `sha256sum dist/sandbox/*`, apply the
change, rebuild, and compare.

## Differences from dinkus-inventory

- `--url` names the EmDash site, and the CLI derives the plugin route base,
  instead of `--endpoint` naming a service API. There is no
  `--site`, `--pool`, or `--location`: an EmDash site is one store.
- `--plugin-id` selects the runtime plugin id, because EmDash serves plugin
  routes under that id.
- The credential is `EMDASH_TOKEN`, shared with the upstream `emdash` CLI,
  because EmDash, not Commerce, authenticates plugin routes. Public reads never
  send it.
- `context` is `{ siteUrl, pluginId }`.
- No mutation is wired, so there is no `commandId`, receipt, unknown outcome,
  or pending-command store yet. Those arrive with the preview/confirm routes.
- The kernel's `httpFailure` reads a top-level string `error`. EmDash returns
  `{ success: false, error: { code, message } }`, so the client unwraps that
  object before mapping the status.

## Implementation status

| Command | State | Route used |
| --- | --- | --- |
| `catalog list` | Wired | `GET catalog/public[?cursor=]` (Registry build) |
| `catalog show` | Wired | `GET catalog/public/item?itemId=` (Registry build) |
| `products list` | Wired | `GET catalog-items/list` with `EMDASH_TOKEN` (native build) |
| `products set-price`, `set-sale-price`, `set-sku` | Planned | No preview/confirm route |
| `orders list`, `orders show` | Planned | No JSON orders route |
| `settings show` | Planned | No complete read-only settings route |

## Acceptance checks

`tests/cli/dinkus-commerce.test.mjs`, run by `npm run test:unit`, proves:

- help at every depth and `--version` (including spawning the bin);
- exactly one JSON document in `--json` mode and escaped `--plain` records;
- the stdout/stderr split and the next-page hint on stderr;
- that the token never appears in output, is never sent to public routes, and
  is never sent to a site URL from project config;
- the exit-code mapping `0`-`5`, including EmDash 401/403/404/5xx envelopes;
- required and validated `--url`, `--plugin-id`, and config precedence;
- that planned mutations fail closed under `--no-input` and contact nothing;
- a real HTTP round trip on loopback;
- that the CLI route ids match the built package's exported route constants;
- the bundle boundary in [Bundle budget](#bundle-budget).
