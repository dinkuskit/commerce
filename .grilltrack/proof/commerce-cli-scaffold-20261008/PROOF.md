# Proof: commerce-cli-scaffold-001

Decision: expose `dinkus-commerce` as a package bin that talks to Commerce only
over mounted plugin HTTP routes.

- Contract: `docs/CLI-SPEC.md` (locked for this scaffold slice)
- Executable: `bin/dinkus-commerce.mjs`, `cli/`
- Boundary tests: `tests/cli/dinkus-commerce.test.mjs`
- Registry backend: CLI is not in the sandbox bundle

No live site, no real EmDash token, no Registry publication.
