---
name: commerce-cli
description: Read a Commerce catalog, product list or orders on an EmDash site with the dinkus-commerce CLI, mark an order shipped when the owner asks, and know which install and credential each command needs.
---

# Commerce CLI

The CLI does the mechanics; the contract is [docs/CLI-SPEC.md](../../docs/CLI-SPEC.md).
Run it from a checkout as `bin/dinkus-commerce.mjs` (Node 22.23.2, no build
needed) and start with `--help` at the depth you need.

1. Point it at a site with `--url <site-url>` or `EMDASH_URL`, or a
   `.dinkuskit/commerce.json` profile for public reads. Admin commands refuse
   a project-config URL (`untrusted_site_url`) or plugin id
   (`untrusted_plugin_id`); pass `--url` and `--plugin-id` for them. Use
   `--plugin-id` only when the site installed Commerce under a different id.
2. Pick the command for the install. `catalog list|show` reads the public
   storefront projection on the Registry (sandboxed) build and needs no
   credential. `products list` needs the native build and `EMDASH_TOKEN`.
   `orders list|show|complete|reopen` need the Registry build and an
   `EMDASH_TOKEN` of an administrator. `orders list --status processing` is
   what still needs shipping; an order marked `(TEST)` (`"test": true`) took no
   real money and gets no postage.
3. Supply `EMDASH_TOKEN` from the operator's secret manager for admin commands.
   It must be an EmDash personal access token with the `admin` scope. Never put it in a flag,
   config file, transcript, or log.
4. Use `--json` (one document) or `--plain` (one record per line) when another
   tool reads the output. Use `catalog list --all` instead of looping cursors
   by hand.
5. Read the exit code before the text: `1` not found or not available on this
   install, `2` fix the invocation, `3` retry later, `4` credential or
   permission, `5` stop and report a contract mismatch.

Marking an order shipped is a change to a live store. Run `orders complete`
(or `orders reopen`) only for an order the store owner asked you to change,
and only after the order has really shipped. Run it with `--dry-run` first,
check the order and version it shows, then repeat the same command with
`--confirm <version>`. Exit `1` with `outdated` means the order changed since
that read: show it again instead of retrying blindly. Completed means shipped,
never delivered, and Commerce sends no email for it.

Commands marked `(planned)` exit `1` with `not_implemented` and send nothing.
Do not work around them by calling the native `catalog-items/set-*` routes
directly: price and SKU changes wait for Commerce preview/confirm routes so a
human approves the exact change.

Apart from the order changes above, this skill reads store data only. It does
not authorize publishing, deployment, or any other production mutation, and
output from a live site may contain store data (including shoppers' names,
addresses and emails) that must not be committed.
