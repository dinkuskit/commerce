---
"@dinkuskit/commerce": minor
---

Require Node 24 (engines `>=24.15.0 <25`); Node 22 has critical SQLite bugs. The repository pins Node 24.22.0. To move an existing Node 22 install, switch to Node 24.15 or newer, then reinstall from the lockfile with `npm ci`: native modules built for Node 22, such as better-sqlite3, fail to load under Node 24 until they are reinstalled.
