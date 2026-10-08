---
name: commerce-cli
description: Read a Commerce catalog or product list on an EmDash site with the dinkus-commerce CLI, and know which install and credential each command needs.
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
3. Supply `EMDASH_TOKEN` from the operator's secret manager for admin commands.
   It must be an EmDash personal access token with the `admin` scope. Never put it in a flag,
   config file, transcript, or log.
4. Use `--json` (one document) or `--plain` (one record per line) when another
   tool reads the output. Use `catalog list --all` instead of looping cursors
   by hand.
5. Read the exit code before the text: `1` not found or not available on this
   install, `2` fix the invocation, `3` retry later, `4` credential or
   permission, `5` stop and report a contract mismatch.

Commands marked `(planned)` exit `1` with `not_implemented` and send nothing.
Do not work around them by calling the native `catalog-items/set-*` routes
directly: price and SKU changes wait for Commerce preview/confirm routes so a
human approves the exact change.

This skill reads store data only. It does not authorize publishing, deployment,
or production mutation, and output from a live site may contain store data that
must not be committed.
