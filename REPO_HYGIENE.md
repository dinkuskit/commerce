# Repository Hygiene

The root is a small public lobby. Allowed root documents are `README.md`,
`AGENTS.md`, `VISION.md`, `REPO_HYGIENE.md`, `CONTRIBUTING.md`, `SECURITY.md`,
`CLAUDE.md`, and `LICENSE`. Product depth belongs under `docs/`; deterministic
helpers under `scripts/`; tests under `tests/`; product decisions and curated
review evidence under `.grilltrack/`.

Forbidden material includes environment files, credentials, customer or tenant
data, SQL/data exports, private plans or proof, imported Git history, local
agent shelves, generated run directories, and files copied wholesale from a
private predecessor.

Run `npm run audit:repo` before every commit. The audit is intentionally
value-blind: it enforces public-safe paths and manifest identity without
printing file contents.
