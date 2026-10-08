# Product media review adjudication

## Round 1 — source `git:1e0995c3d778dfb430983fe75b2cee4632651788`

Separate read-only review by a subagent (no build, no test execution, no edits) against the baseline `4a8fac510772dcce7be5280c9b9d7c0360d15e92`, on two axes: repository standards (AGENTS.md, FEATURE_MAP.md boundary rules, CONTRIBUTING.md, REPO_HYGIENE.md) and the current `product-media-*` decision text. The reviewer proposed classifications; the adjudication below is the maintainer-delegated decision.

| # | Finding | Reviewer | Adjudicated | Action |
| --- | --- | --- | --- | --- |
| 1 | Gallery Move up / Remove carry a positional index without CAS; a stale page can act on a different image than its label named (`src/admin/index.ts` `saveGallery`, `media.remove`, `media.up`) | defer | **required_fix** (narrowed) | Buttons now carry the media id as well; the handler refuses when the id at that position no longer matches ("The gallery changed since this page loaded"). Full compare-and-set for the isolated media record stays deferred, consistent with the other isolated setters (`manual-availability`, `set-backorders`, `price`, `listing`). |
| 2 | `docs/implementation/product-media.md` says an "unknown media id" is refused; code refuses only a malformed id (projection tolerates dangling references by decision 2) | defer | **required_fix** (doc) | Wording corrected to "malformed media id". |
| 3 | A refused placeholder choice falls through to the generic alert instead of the Settings page | defer | **required_fix** | Recovery now re-renders Commerce Settings with the reason for placeholder actions too. |
| 4 | One `media.get` bridge call per distinct media id per public request; `no-store` forbids host caching | defer | **defer** | Mandated by decision 2 (live reads); recorded in PROOF.md fidelity; batching or bounded host caching is a later grill. |
| 5 | Lingui equivalence: (a) Lingui decodes literal `\u`/`\x` escape sequences in the final string, the local interpolator does not; (b) production-mode Lingui leaves uncatalogued placeholders raw | defer / reject | **defer** (a), **reject_false_positive** (b) | (a) Intentional: not decoding runtime values is the safer behaviour; doc and test comment now state the difference. (b) Unreachable: `scripts/coupon-catalog.mjs` fails the build on any uncatalogued `t()` literal. |
| 6 | Admin preview alt skips the caption fallback; chooser labels by filename | reject | **reject_false_positive** | Decision 2's chain governs the public projection, which is implemented and tested; admin-only previews may name files. |
| 7 | Forged `media.up` with index 0 reports "Gallery reordered" on a no-op; forged gallery `media.clear` is refused generically | reject | **reject_false_positive** | Not reachable from rendered controls; no storage effect. |
| 8 | `src/features/catalog/media-projection.ts` comment names `Astro.locals.emdash.handleMediaGet`, which the anonymous page path does not carry | defer | **required_fix** (comment) | Comment now names `handleMediaGet(await getDb(), id)` plus `getPublicMediaUrl(storageKey)`. |
| 9 | `tests/admin-media.test.mjs` Cancel assertion falls back to the chooser's button and does not assert storage | defer | **required_fix** (test) | Test now uses the chooser's Cancel explicitly and asserts the media record is unchanged. |

No findings on: second media store, admin URL leakage in the public catalog, capability scope beyond `media:read`, price/stock/claim writes from media paths, block_action and native input validation, reorder/remove correctness on a live page, build levers (audited transform, minify and catalog contents untouched), feature boundary rules, test edits (additive), proof capture public-safety, ledger additions, exclusions.

Not checked by the reviewer: nothing was built or executed; unit counts, browser results, artifact size and hash were taken from PROOF.md.

Required fixes route decisions 1, 3, 4 and 5 back through implementation and verification; round 2 below binds the repaired source.

## Round 2 — source `git:5cb59c6c302b8255e5c23b55fca8f31d28037361`

Separate read-only review (new subagent, no build or test execution) of the repair commit against round one. Verdict: **clean**. Each required fix (1, 2, 3, 8, 9) was confirmed resolved with file and test evidence; the stale-page check refuses before any write, the placeholder recovery path is render-only, proof size/hash/run claims match the on-disk artifact and run record, the ledger shows the round-one classifications bound to `1e0995c` and the re-implementation/re-verification of decisions 1, 3, 4 and 5, and the committed captures and JSON are public-safe.

Three non-blocking notes, adjudicated:

| # | Note | Adjudicated | Action |
| --- | --- | --- | --- |
| A | A stale page whose gallery shrank below the clicked index gets the generic "reload and try again" message instead of the "gallery changed" wording | **reject_false_positive** | Both paths refuse, tell the clerk to reload, recover to the product and change nothing. |
| B | Decision 5's locked text names `Astro.locals.emdash.handleMediaGet`; the verified anonymous path is `handleMediaGet(await getDb(), id)` + `getPublicMediaUrl(storageKey)` | **defer** | Recorded in PROOF.md fidelity and the product-media doc; the decision text's "for example" wording is a maintainer-owned amendment, not a code change. |
| C | PROOF.md "affected suites 37/37" was undefined | **defer** (wording) | PROOF.md now names the four suites behind that count. |

Round 2 binds the product source at `5cb59c6`; the commit that records this adjudication changes only `.grilltrack/` ledger, event and proof files.
