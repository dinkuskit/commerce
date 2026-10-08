# Proof: commerce-cli-scaffold-001

Decision: expose `dinkus-commerce` as a package bin that talks to Commerce only
over mounted plugin HTTP routes.

- Contract: `docs/CLI-SPEC.md` (locked for this scaffold slice)
- Executable: `bin/dinkus-commerce.mjs`, `cli/`
- Boundary tests: `tests/cli/dinkus-commerce.test.mjs`
- Registry backend: CLI is not in the sandbox bundle
- Token destination: admin commands refuse a site URL (`untrusted_site_url`) or
  plugin id (`untrusted_plugin_id`) that came from project config, before any
  request is built. Tests cover the nearest forbidden case (trusted
  `EMDASH_URL` plus a project-config `plugin-id`: exit `4`, zero requests) and
  the allowed sources (`--plugin-id`, user config, the built-in default) still
  reaching `/_emdash/api/plugins/dinkus-commerce/catalog-items/list`.

No live site, no real EmDash token, no Registry publication.
