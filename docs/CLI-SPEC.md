# `dinkus-commerce` CLI Specification

Status: Locked for the scaffold slice (`commerce-cli-scaffold-001`). Product
commands use the catalog API (`catalog-api-20261027`, commerce#190).

An unpublished scaffold executable implements the read commands below against
the HTTP routes Commerce already serves; see
[Implementation status](#implementation-status). The shape mirrors the locked
`dinkus-inventory` specification (global flags, JSON envelope, plain records,
exit codes, config precedence, credential handling). Differences are listed in
[Differences from dinkus-inventory](#differences-from-dinkus-inventory).

## Name and purpose

Executable: `dinkus-commerce`

Package: `@dinkuskit/commerce` (`0.2.0` release preparation; npm unpublished)

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

Package `files` now includes the `cli` support dependency closure for the already
declared `bin/dinkus-commerce.mjs`, while the package is in public `0.2.0` release preparation and
unpublished. The CLI has no export-map entry and adds zero Registry/sandbox
bundle bytes. Publishing the CLI is out of scope until the package itself is published.

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
dinkus-commerce products show <item-id>
dinkus-commerce products create --name <name> --sku <sku> --command-id <id> [--page <entry-id>] [--dry-run]
dinkus-commerce products set-price <item-id> (--amount <decimal> | --clear) [--choice <item-id>] (--dry-run | --confirm <value>)
dinkus-commerce products set-sale-price <item-id> (--amount <decimal> | --clear) [--choice <item-id>] (--dry-run | --confirm <value>)
dinkus-commerce products set-stock-status <item-id> --status <in-stock|out-of-stock|on-backorder> [--choice <item-id>] (--dry-run | --confirm <value>)
dinkus-commerce products set-sku <item-id> --sku <sku> (--dry-run | --confirm <value>)
dinkus-commerce products set-weight <item-id> (--oz <decimal> | --clear) (--dry-run | --confirm <value>)
dinkus-commerce products set-identifiers <item-id> [--gtin <gtin>] [--mpn <mpn>] [--brand <brand>] (--dry-run | --confirm <value>)
dinkus-commerce products save-media <item-id> [--image <media-id> | --clear-image] [--gallery <media-id> ... | --clear-gallery] (--dry-run | --confirm <value>)
dinkus-commerce products set-feeds <item-id> (--channel <channel> ... | --none) (--dry-run | --confirm <value>)
dinkus-commerce products add-choice <item-id> --name <label> --value <label> --value <label>=<sku> ... (--dry-run | --confirm <value>)
dinkus-commerce products link <item-id> --page <entry-id> (--dry-run | --confirm <value>)
dinkus-commerce products archive <item-id> (--dry-run | --confirm <value>)
dinkus-commerce products restore <item-id> (--dry-run | --confirm <value>)

dinkus-commerce orders list [--status <processing|completed>] [--cursor <cursor>] [--all]
dinkus-commerce orders show <order-id>
dinkus-commerce orders complete <order-id> [--carrier <text>] [--tracking <text>] (--dry-run | --confirm <version>)
dinkus-commerce orders reopen <order-id> (--dry-run | --confirm <version>)
dinkus-commerce orders address <order-id> --name <text> --line1 <text> [--line2 <text>] --city <text> [--region <text>] --postal-code <text> --country <code> (--dry-run | --confirm <version>)

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
  site answers `404`, and the CLI sends `{ "op": "list" }` to `POST catalog`
  instead, which lists each product's `catalogItemId`, `name`, `sku` and
  `archivedAt`; `products show` has its prices. A Commerce older than 0.7.0
  has neither and exits `1` with `route_not_available`.
- `products show <item-id>` sends `{ "op": "get", "catalogItemId" }` to
  `POST catalog`: the product as its page panel shows it (prices, stock,
  state, weight, identifiers, choices and their versions), its pictures and its
  feed channels.

Both public routes are mounted by the Registry (sandboxed) build
(`src/plugin.ts`) and the native build (`src/index.ts`), with the same request
rules and response (GrillTrack `catalog-native-public-routes-001`). The
`catalog` commands therefore work on either install, and so do the `products`
commands on Commerce 0.7.0 or later.

### Product commands

Every product command except `products list` sends one or more `POST catalog`
calls with a JSON body and the credential. The route is private and needs
`content:edit_any`, the permission the product page panels use; both builds
mount it. Each body names one `op` and runs the panels' own checks:

| CLI command | Body |
| --- | --- |
| `products show` | `{ op: "get", catalogItemId }` |
| `products create` | `{ op: "create", commandId, name, sku, entryId? }`: a physical Draft with Manage stock off. The same `commandId` again answers with the same product. |
| `products set-price`, `set-sale-price`, `set-stock-status` | `{ op: "prices", catalogItemId, regular, sale, stockStatus? }`, the panel's one Save, with the values the command does not change read from `get`. `--choice` names one version of a product sold in choices. |
| `products set-sku` | `{ op: "sku", catalogItemId, sku }` |
| `products set-weight` | `{ op: "weight", catalogItemId, weightOz }` (`""` clears it) |
| `products set-identifiers` | `{ op: "identifiers", catalogItemId, gtin?, mpn?, brand? }` (`""` clears a field) |
| `products save-media` | `{ op: "media", catalogItemId, image?, gallery? }` |
| `products set-feeds` | `{ op: "feeds", catalogItemId, channels }` |
| `products add-choice` | `{ op: "choice", productId, optionId, optionLabel, values }`: the product's first choice. The first value is the product itself; each other value makes a version with its own SKU, named from the product, with a command id made from the product and the value so a retry resumes. Later choices are added in the panel. |
| `products link` | `{ op: "link", catalogItemId, entryId }` |
| `products archive`, `products restore` | `{ op: "archive", catalogItemId, archived }`; a restored product is a Draft. |

`products create --page` and `products link` record which page sells the
product. Commerce keeps that link; the page has no product field to set
(`catalog-page-link-in-commerce-20261029`). Publishing the page through EmDash
(its content API or MCP) then puts the product on sale: the store's publish
check sends Commerce only the page, and Commerce finds the product. A store
whose template predates this still reads the page's own `commerce_item_id`
field when it publishes; on such a store, set that field to the product's
`catalogItemId` too, or update the store first.

The route also has `labels` (rename a choice or its values), which the CLI
does not wrap yet. A refused price save answers `{ saved: false, message }`,
which the CLI reports as `refused` with Commerce's message. A Registry store
answers other refusals as `400` with code `ROUTE_ERROR` and Commerce's reason
after `route catalog failed: `; the CLI reports that as `refused` with the
reason. A native store answers with Commerce's own error code
(`SKU_CONFLICT`, `INVALID_INPUT` and so on), which the CLI keeps. Publishing the
product's page is what puts it on sale; no CLI command does that.

`products create` is additive and needs no confirmation: a retry with the same
`--command-id` never makes a second product, and `--dry-run` prints the
request and sends nothing. Every other write is a change to a product someone
may be looking at, so it follows the confirm flow below.

### Orders commands

Every `orders` command sends one `POST orders` with a JSON body and the
credential (GrillTrack `commerce-orders-api-001`; `address` is
`commerce-orders-api-address-001`). The route is private: EmDash
requires `plugins:manage` (an administrator) and, for API tokens, the `admin`
scope, and Commerce checks the administrator again, like its Orders page. Only
the Registry (sandboxed) build mounts it; on a native install the site answers
`404` and the CLI exits `1` with `route_not_available`.

| Body | Answer |
| --- | --- |
| `{ "action": "list", "status"?: "processing" \| "completed", "offset"?: n }` | `{ orders, total, next? }`: up to 50 orders by order number from `offset`; `next` is the next page's offset. |
| `{ "action": "show", "orderId" }` | `{ order }`, or `{ "order": null }` when no order has that id. |
| `{ "action": "complete", "orderId", "version", "carrier"?, "tracking"? }` | `{ result, order }` |
| `{ "action": "reopen", "orderId", "version" }` | `{ result, order }` |
| `{ "action": "address", "orderId", "version", "address": { name, line1, line2?, city, region?, postalCode, country } }` | `{ result, order }` |

Unknown actions or fields, and malformed values, are refused before anything
changes (a misspelt `trackingNumber` is an error, not ignored). Each order is:

```json
{
  "orderId": "order:demo", "number": 1001, "version": 1,
  "status": "processing", "test": true, "paidAt": "2026-10-10T01:00:00.000Z",
  "total": { "currency": "USD", "minor": "1250" },
  "lines": [{ "catalogItemId": "item_demo", "quantity": 2, "name": "Demo Mug", "unitPrice": { "currency": "USD", "minor": "625" } }],
  "choices": [],
  "shipTo": { "name": "Demo Shopper", "line1": "1 Example Way", "city": "Testville", "region": "CA", "postalCode": "90000", "country": "US" },
  "email": "shopper@example.test", "phone": null, "completed": null,
  "billTo": { "name": "Demo Shopper", "line1": "1 Example Way", "city": "Testville", "region": "CA", "postalCode": "90000", "country": "US" },
  "billToMatchesShipTo": true
}
```

`number` is null for an order kept before numbering until the Orders page
numbers it. `status` is `processing` until the order ships and `completed` once
it shipped (never "delivered"). `test` is false only for an order taken in live
mode. `shipTo` is the owner's corrected address when there is one, else the
checkout address, or null for digital-only orders. `billTo` is the billing
address frozen at checkout, always a full copy (null only for orders paid before
billing was recorded); `billToMatchesShipTo` is true when it equals `shipTo`
field for field. `choices` are the frozen option choices. `completed` is
`{ at, carrier?, tracking? }` once Completed. `orders show` prints `bill to`.

`complete`, `reopen` and `address` follow the Orders page's rules and apply
only at the order `version` named, so a change made from a stale read changes
nothing. `address` is the Orders page's Correct address: it replaces the whole
delivery address (`shipTo`), checked as checkout checks one, and never changes
billing. `result` is `saved`, `outdated` (the version moved on, the order is
already in that status, or for `address` the order is Completed: reopen it
first), `invalid` (carrier or tracking over 64 characters or with a line break;
for `address`, a missing or too-long line, an order with no delivery address,
or a country outside the store's shipping countries) or `not_found`; `order` is
the order as it now stands. Commerce
sends no email either way. When the store has Ship's hosted service, a saved
change goes to Ship right away, and Ship emails the shopper when the order
becomes Completed ([Orders and Ship](implementation/registry-ship-sync.md)).

- `orders list` prints one page and, when more exist, a cursor (the next
  offset) for `--cursor`; `--all` follows every page. `--status processing`
  lists what still needs shipping.
- `orders show <order-id>` prints one order; a missing id exits `1` with
  `not_found`.
- `orders complete` and `orders reopen` change an order. The order the route
  returns is the preview and its `version` is the confirmation value, because
  Commerce applies the change only at that version. `--dry-run` reads the order,
  shows the change, and prints `confirmation` (the version); nothing changes. A
  run with `--confirm <version>` sends the change for that version. Without
  either, an interactive run shows the preview and asks for the version;
  `--no-input` or a non-interactive run without `--confirm` exits `4` with
  `confirmation_required` and sends nothing. A refusal exits `1` with the
  `result` as `error.code` (`outdated`, `invalid`, `not_found`); completing an
  order that is already Completed, or reopening one that is Processing, exits
  `1` with `already_completed` or `already_processing` before anything is sent.
- `orders address` corrects where a Processing order goes, with the same
  preview and `--confirm <version>` flow. `--name`, `--line1`, `--city`,
  `--postal-code` and `--country` are required; `--line2` and `--region` are
  optional, and the whole address is replaced. The preview prints the current
  and new address. A Completed order exits `1` with `order_completed`, and an
  order with no delivery address with `no_address`, before anything is sent.

### Planned commands

Planned commands appear in help with a summary ending in `(planned)`. They
accept their documented arguments, then exit `1` with code `not_implemented`
and a message naming the missing API. They never contact the site.

| Command | Missing API |
| --- | --- |
| `settings show` | A read-only settings route. Native can read `settings/out-of-stock-listing` and `settings/placeholder-image` but not `settings/storefront-availability`; the Registry build has none. |

### Confirming a product change

A product change is bound to what its preview read, and Commerce checks it
(his call, 27 Oct):

1. `--dry-run` reads the product with `get`, prints the current and new
   values, and prints a confirmation value: the first 12 hex digits of the
   SHA-256 of that `get` answer as JSON. Nothing changes.
2. A real run asks the operator to type that value, or, with `--no-input`,
   requires `--confirm <value>` from a fresh dry run. Without either it exits
   `4` with `confirmation_required` and sends nothing.
3. The CLI reads the product again and stops with `outdated` if it no longer
   matches, then sends the change with the value as `expected` (and, for a
   choice, the product as `productId`). The catalog route reads the product
   once more and saves only if it still hashes to `expected`; otherwise it
   refuses with "The product changed since that preview", which the CLI
   reports as `outdated`. Nothing changes either way.

Commerce's check runs inside the same request as the save, so the window a
concurrent edit could slip through shrinks from a network round trip to the
moment between that read and the write, and each write is still conditional.
`orders complete`, `orders reopen` and `orders address` are bound on the
server by the order version. There is no generic `--force`.

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
| `--timeout <duration>` | Per-request network timeout, including reading the response body, such as `1500ms`, `15s`, or `1m`; default `15s`, maximum `10m`. |

## Command flags

| Flag | Command | Contract |
| --- | --- | --- |
| `--cursor <cursor>` | `catalog list`, `orders list` | Page cursor from a previous page. Opaque for `catalog list`, 1-1024 characters; for `orders list` the page offset the CLI printed. |
| `--all` | `catalog list`, `orders list` | Follow every page and return one combined list. |
| `--status <processing\|completed>` | `orders list` | Only Processing (not shipped) or Completed (shipped) orders. |
| `--carrier <text>`, `--tracking <text>` | `orders complete` | Optional carrier and tracking number, at most 64 characters each. |
| `--name`, `--line1`, `--line2`, `--city`, `--region`, `--postal-code`, `--country` | `orders address` | The corrected delivery address; `--line2` and `--region` are optional. Commerce checks it as checkout does; `--country` is two letters and must be one the store ships to. |
| `--dry-run` | `orders complete`, `orders reopen`, `orders address` | Show the change and the version to confirm; send nothing. |
| `--confirm <version>` | `orders complete`, `orders reopen`, `orders address` | Apply only if the order is still at this version. |
| `--amount <decimal>` | `products set-price`, `products set-sale-price` | USD amount such as `19.99`; or `--clear`. |
| `--clear` | `products set-price`, `set-sale-price`, `set-weight` | Clear the value instead. |
| `--choice <item-id>` | `products set-price`, `set-sale-price`, `set-stock-status` | The version of a product sold in choices, from `products show`. Required for such a product. |
| `--status <...>` | `products set-stock-status` | `in-stock`, `out-of-stock` or `on-backorder`. Refused when Inventory manages the stock. |
| `--name <name>`, `--sku <sku>`, `--command-id <id>` | `products create` | Required. `--sku` is also `products set-sku`'s new SKU; the item id never changes. |
| `--page <entry-id>` | `products create`, `products link` | The Products page entry that sells it. |
| `--oz <decimal>` | `products set-weight` | Ounces, above 0 and up to 2400. |
| `--gtin`, `--mpn`, `--brand` | `products set-identifiers` | An empty value clears it; a field left out stays. |
| `--image <media-id>`, `--gallery <media-id>` (repeatable), `--clear-image`, `--clear-gallery` | `products save-media` | EmDash media ids; `--gallery` replaces the whole gallery. |
| `--channel <channel>` (repeatable), `--none` | `products set-feeds` | Product feed channels, such as `google-merchant`. |
| `--name <label>`, `--value <label>[=<sku>]` (repeatable) | `products add-choice` | 2 to 50 values; the first is the product itself (no SKU). |
| `--dry-run` | product changes | Show the change and the confirmation value; send nothing. |
| `--confirm <value>` | product changes | Commerce saves only while the product still matches that dry run. |

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
`{ products, manageStockControl }` payload. `orders list` is
`{ orders, total, cursor? }` (`cursor` is the route's `next` as a string),
`orders show` is one order, and a saved `orders complete`, `orders reopen` or
`orders address` is the route's `{ result, order }`. A preview uses
`outcome: "preview"`, with
`data: { orderId, number, version, from, to, carrier?, tracking? }` (for
`orders address`, `from` and `to` are the current and new address) and
`confirmation` set to the version to pass to `--confirm`; a product change's
preview is `data: { catalogItemId, request }` with the 12-digit confirmation
value, and a saved one is the catalog route's answer. A refused change
keeps the route's answer in `data` beside `error`. A failure uses
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
- `orders list`: `record=order orderId number version status test total.minor total.currency paidAt`,
  then `record=cursor cursor` when another page exists.
- `orders show`, `orders complete`, `orders reopen`, `orders address`: one record of flattened
  `context.*` and `data.*` fields (plus `confirmation` for a preview); arrays
  are JSON.
- Any failure: `code message`.

JSON and plain field names are compatibility surfaces within
`dinkuskit.commerce.cli/v1`; new optional fields may be added.

## Exit codes

| Code | Meaning in `dinkus-commerce` |
| --- | --- |
| `0` | Successful read. |
| `1` | Ordinary failure with no change: `not_found`, `route_not_available` (HTTP 404), `not_implemented`, a 4xx business error, or `page_limit`. |
| `2` | Usage: unknown command or flag, missing argument, `--json` with `--plain`, invalid `--url`, `--plugin-id`, `--cursor`, `--timeout`, missing site URL, invalid or secret-bearing config. |
| `3` | Site unreachable, timeout, request interrupted, Ctrl-C after a change request starts dispatch, or HTTP 5xx. |
| `4` | Credential missing (`credential_required`), rejected (401), or not permitted (403, including `INSUFFICIENT_SCOPE`), an admin command whose site URL or plugin id came from project config (`untrusted_site_url`, `untrusted_plugin_id`), a confirmation gate, or Ctrl-C before a change request starts dispatch. |
| `5` | The response is not the EmDash `{ success, data }` envelope or the payload breaks the documented shape. |

Service error codes such as `INVALID_TOKEN` or `INSUFFICIENT_SCOPE` are passed
through as `error.code`.

Timeouts and connection failures use exit `3` even if the server
already sent its response headers. The CLI does not automatically retry them.
For a write, a missing complete response does not prove nothing changed: read
the product or order before deciding whether to submit again.

Ctrl-C before a change request starts dispatch exits `4` and reports that no
change was sent. Once a catalog or order change starts dispatch, Ctrl-C exits
`3` and reports that the outcome is unknown, including while waiting for the
response body. Starting fetch is not proof of server receipt or a durable save;
read back the product or order before resubmitting. Read-only catalog/order POSTs
do not mark a change, and credential/destination refusals or a signal already
aborted before dispatch do not send one. There is no automatic retry.

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

A requested profile must be an explicit entry in at least one config file's
`profiles` object. An absent name exits `2` with `unknown_profile`; inherited
JavaScript names such as `constructor` do not count as entries. Those names are
still usable when explicitly defined in JSON. When a profile is requested,
each present `profiles` map and every matching entry must be a JSON object
(not null, an array, or a primitive); otherwise the CLI exits `2` with
`invalid_config` before sending any HTTP request. A string such as
`"staging": "https://staging.shop.example"` is not a profile override and
must not silently select the base URL instead.

A valid profile object overrides that file's base metadata; an empty object
intentionally inherits it. Base configuration without a requested profile and
unselected entries keep their existing behavior. Flag/environment precedence
and the project-config credential restrictions below are unchanged.

A config file containing a token, secret, password, authorization, credential,
API key, or cookie key is rejected with exit `2`.

The credential comes only from `EMDASH_TOKEN`, the variable the upstream
`emdash` CLI uses. It is an EmDash personal access token sent as
`Authorization: Bearer`. Private plugin routes require the `admin` scope,
and `products list` requires a user with
`content:edit_any`, as do the other `products` commands. Non-GET admin calls
also send `X-EmDash-Request: 1` (EmDash's CSRF header). There is no `--token` flag, no token in config, and no
printing of the token or the authorization header. Public `catalog` reads never
send the token, even when it is set. Admin commands without it exit `4`, naming
`EMDASH_TOKEN`.

Admin commands send the token only to a site URL from `--url`, `EMDASH_URL`,
or user config, and only to a plugin id from `--plugin-id`, user config, or
the built-in default. Project config comes with the working directory (a cloned
repository, for example), so when it supplies the URL an admin command exits
`4` with `untrusted_site_url`, and when it supplies the plugin id it exits `4`
with `untrusted_plugin_id`, before sending anything. Public `catalog` reads
may still use project-config values because they carry no credential.

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

# Orders that still need shipping, then mark one shipped after checking the preview.
EMDASH_URL=https://shop.example dinkus-commerce orders list --status processing
EMDASH_URL=https://shop.example dinkus-commerce orders complete order:demo --carrier USPS --tracking 9400100000000000000000 --dry-run
EMDASH_URL=https://shop.example dinkus-commerce orders complete order:demo --carrier USPS --tracking 9400100000000000000000 --confirm 1

# Correct where an order goes before shipping it.
EMDASH_URL=https://shop.example dinkus-commerce orders address order:demo --name 'Sam Buyer' --line1 '2 Main St' --city Knoxville --region TN --postal-code 37902 --country US --dry-run

# Migrate a product: a Draft for its page, a price, then a Size choice.
EMDASH_URL=https://shop.example dinkus-commerce products create --name Runtz --sku F-RUNTZ --command-id gfb-runtz --page 01J0PAGE --json
EMDASH_URL=https://shop.example dinkus-commerce products set-price item_demo --amount 22.00 --dry-run
EMDASH_URL=https://shop.example dinkus-commerce products set-price item_demo --amount 22.00 --confirm 3f9a0c1b2d4e
EMDASH_URL=https://shop.example dinkus-commerce products add-choice item_demo --name Size --value Small --value Large=F-RUNTZ-L --dry-run
```

## Non-goals

- Publishing the CLI. The package is in public `0.2.0` release preparation and npm unpublished; package
  `files` includes the `cli` support dependency closure for already declared
  `bin/dinkus-commerce.mjs`, while the CLI has no export-map entry and adds
  zero Registry/sandbox bundle bytes.
- Any byte in the Registry bundle `dist/sandbox/plugin.mjs` from the CLI
  itself. The `catalog` route it calls is Commerce's own API for every agent.
- Direct storage or database access, importing Commerce source, or
  reimplementing price, sellability, availability, or checkout rules.
- A generic `--force`, and any change that is not bound to its preview
  (`products`) or to the order version (`orders`).
- Shopper operations: guest checkout `prepare`/`start`/`status`, carts, coupons,
  and payments.
- Media upload (use `emdash media`), product deletion (archive instead),
  publishing a product page, and Inventory stock operations (use
  `dinkus-inventory`).
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
- Order changes are bound to the order version and product changes to their
  preview code rather than a command id, so a lost answer is resolved by reading again:
  there is no receipt, unknown outcome, or pending-command store yet. Only
  `products create` and `products add-choice` carry a command id, so a retry
  finds what the first try made.
- The kernel's `httpFailure` reads a top-level string `error`. EmDash returns
  `{ success: false, error: { code, message } }`, so the client unwraps that
  object before mapping the status.

## Implementation status

| Command | State | Route used |
| --- | --- | --- |
| `catalog list` | Wired | `GET catalog/public[?cursor=]` (both builds) |
| `catalog show` | Wired | `GET catalog/public/item?itemId=` (both builds) |
| `products list` | Wired | `GET catalog-items/list` with `EMDASH_TOKEN` (native build), else `POST catalog` `{op: list}` (Commerce 0.7.0+) |
| `products show`, `create` and every product change | Wired | `POST catalog` with `EMDASH_TOKEN` (both builds, Commerce 0.7.0+) |
| `orders list`, `orders show` | Wired | `POST orders` with `EMDASH_TOKEN` (Registry build) |
| `orders complete`, `orders reopen`, `orders address` | Wired | `POST orders` with `EMDASH_TOKEN`, bound to the confirmed order version (Registry build) |
| `settings show` | Planned | No complete read-only settings route |

## Acceptance checks

`tests/cli/profile-selection.test.mjs`, also run by `npm run test:unit`, covers
missing inherited names, malformed selected profiles/maps, flag and environment
selection, all output modes, explicitly defined prototype-like names, valid
overrides, and unchanged project-config credential restrictions. Two executable
loopback cases use the real catalog handler with synthetic in-memory storage
to verify that invalid requested profiles send no creation request and keep no
Draft at the base site. This is local CLI/HTTP proof, not external EmDash host
or deployment qualification.

`tests/cli/dinkus-commerce.test.mjs`, run by `npm run test:unit`, proves:

- help at every depth and `--version` (including spawning the bin);
- exactly one JSON document in `--json` mode and escaped `--plain` records;
- the stdout/stderr split and the next-page hint on stderr;
- that the token never appears in output, is never sent to public routes, and
  is never sent to a site URL or plugin id from project config;
- the exit-code mapping `0`-`5`, including EmDash 401/403/404/5xx envelopes;
- required and validated `--url`, `--plugin-id`, and config precedence;
- that planned commands and unconfirmed product changes fail closed under
  `--no-input` and contact nothing;
- a real HTTP round trip on loopback;
- that the CLI route ids match the built package's exported route constants;
- the bundle boundary in [Bundle budget](#bundle-budget).

`tests/cli/products-catalog.test.mjs` runs every product command against the
real catalog API over in-memory storage, through EmDash's envelope: a
migration by CLI alone (create and retry, prices, stock, a choice and its
versions, SKU and its conflict), the stale-confirmation refusal, and weight,
identifiers, pictures, feeds, link, archive and restore.
